import { daysInclusive } from "../index.ts";
import type { Workspace, Campaign, Proposal } from "./model.ts";
import {
  forecast,
  budgetAmount,
  monthDate,
  monthEnd,
  ratio,
  estimateCampaign,
  type Context,
  type ForecastMonth,
} from "./engine.ts";

export type Range = { start: string; end: string };
const overlap = (a: Range, b: Range) =>
  Math.max(
    0,
    daysInclusive(
      a.start > b.start ? a.start : b.start,
      a.end < b.end ? a.end : b.end,
    ),
  );
export const finalizedPeriods = (w: Workspace, range: Range) =>
  w.periods.filter(
    (p) =>
      !p.archived &&
      p.status === "finalized" &&
      p.start >= range.start &&
      p.end <= range.end,
  );

export function categoryReport(
  w: Workspace,
  months: ForecastMonth[],
  range: Range,
) {
  const periods = finalizedPeriods(w, range);
  const actualKnown =
    periods.length > 0 && periods.every((p) => p.expensesComplete);
  const fullCoverage =
    periods.reduce((n, p) => n + daysInclusive(p.start, p.end), 0) ===
    daysInclusive(range.start, range.end);
  const forecastCovered =
    months.length > 0 &&
    range.start >= months[0].date &&
    range.end <= monthEnd(months.at(-1)!.date);
  const direct = new Map(
    w.categories.map((c) => [c.id, { budget: 0, forecast: 0, actual: 0 }]),
  );
  for (
    let date = monthDate(range.start);
    date <= range.end;
    date = monthDate(date, 1)
  ) {
    const start = date > range.start ? date : range.start,
      end = monthEnd(date) < range.end ? monthEnd(date) : range.end;
    const m = months.find((m) => m.date === date),
      fraction =
        daysInclusive(start, end) / daysInclusive(date, monthEnd(date));
    for (const b of w.budgets) {
      const row = direct.get(b.categoryId);
      if (!row) continue;
      if (!b.planningOnly)
        row.budget += budgetAmount(
          b,
          start,
          end,
          (m?.values.sessions ?? 0) * fraction,
          (m?.values.revenue ?? 0) * fraction,
        );
      // Forecast lines already include dated events; daily boundaries are explicitly prorated for reporting.
      row.forecast += (m?.budgetLines?.[b.id] ?? 0) * fraction;
    }
  }
  w.transactions
    .filter((t) => periods.some((p) => p.id === t.periodId))
    .forEach((t) => {
      const row = direct.get(t.categoryId);
      if (row) row.actual += t.amount;
    });
  const rows: {
    id: string;
    name: string;
    kind: string;
    depth: number;
    directBudget: number | null;
    budget: number | null;
    forecast: number | null;
    actual: number | null;
    variance: number | null;
    children: boolean;
  }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const c of w.categories
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))) {
      const descendantIds = new Set([c.id]);
      let changed = true;
      while (changed) {
        changed = false;
        w.categories.forEach((x) => {
          if (
            x.parentId &&
            descendantIds.has(x.parentId) &&
            !descendantIds.has(x.id)
          ) {
            descendantIds.add(x.id);
            changed = true;
          }
        });
      }
      const totals = [...descendantIds]
        .map((id) => direct.get(id)!)
        .reduce(
          (sum, d) => ({
            budget: sum.budget + d.budget,
            forecast: sum.forecast + d.forecast,
            actual: sum.actual + d.actual,
          }),
          { budget: 0, forecast: 0, actual: 0 },
        );
      const variableUnknown =
        w.budgets.some(
          (b) =>
            descendantIds.has(b.categoryId) &&
            !b.archived &&
            !b.planningOnly &&
            ["per_session", "percent_revenue"].includes(b.cadence) &&
            b.start <= range.end &&
            (!b.end || b.end >= range.start),
        ) && !forecastCovered;
      rows.push({
        id: c.id,
        name: c.name + (c.archived ? " (archived)" : ""),
        kind: c.kind,
        depth,
        directBudget: variableUnknown ? null : direct.get(c.id)!.budget,
        budget: variableUnknown ? null : totals.budget,
        forecast: forecastCovered ? totals.forecast : null,
        actual: actualKnown ? totals.actual : null,
        variance:
          actualKnown && fullCoverage && !variableUnknown
            ? totals.budget - totals.actual
            : null,
        children: descendantIds.size > 1,
      });
      visit(c.id, depth + 1);
    }
  };
  visit(null, 0);
  return { rows, fullCoverage, periods, forecastCovered };
}

export function campaignEconomics(
  c: Campaign,
  w: Workspace,
  context: Context,
  months: ForecastMonth[],
  range: Range,
) {
  const periods = finalizedPeriods(w, range);
  const rows = w.funnels.filter(
    (f) => f.campaignId === c.id && periods.some((p) => p.id === f.periodId),
  );
  const sum = (
    key:
      | "spend"
      | "clients"
      | "leads"
      | "attributedRevenue"
      | "attributedSessions"
      | "deliveryCosts",
  ) =>
    rows.length && rows.every((r) => r[key] !== null)
      ? rows.reduce((n, r) => n + r[key]!, 0)
      : null;
  const spend = sum("spend"),
    clients = sum("clients"),
    revenue = sum("attributedRevenue"),
    delivery = sum("deliveryCosts");
  const expenses =
    periods.length && periods.every((p) => p.expensesComplete)
      ? w.transactions
          .filter(
            (t) =>
              t.campaignId === c.id && periods.some((p) => p.id === t.periodId),
          )
          .reduce((n, t) => n + t.amount, 0)
      : null;
  const historical = w.funnels.filter(
    (f) =>
      f.campaignId === c.id &&
      w.periods.some(
        (p) =>
          p.id === f.periodId &&
          p.status === "finalized" &&
          !p.archived &&
          (!c.historicalStart || p.start >= c.historicalStart) &&
          (!c.historicalEnd || p.end <= c.historicalEnd),
      ),
  );
  const historicalSessions = historical.reduce(
    (n, f) => n + (f.attributedSessions ?? 0),
    0,
  );
  const historicalUnit = (key: "attributedRevenue" | "deliveryCosts") =>
    historical.length &&
    historicalSessions > 0 &&
    historical.every((f) => f.attributedSessions !== null && f[key] !== null)
      ? historical.reduce((n, f) => n + f[key]!, 0) / historicalSessions
      : null;
  const first = months[0]?.values ?? {};
  const unitRevenue =
    c.economicsSource === "manual"
      ? c.revenuePerSession
      : c.economicsSource === "historical"
        ? historicalUnit("attributedRevenue")
        : ratio(first.revenue ?? 0, first.sessions ?? 0);
  const unitCost =
    c.economicsSource === "manual"
      ? c.deliveryCostPerSession
      : c.economicsSource === "historical"
        ? historicalUnit("deliveryCosts")
        : first.sessions
          ? ((first.clinicianPay ?? 0) +
              (first.employerBurden ?? 0) +
              (first.fees ?? 0)) /
            first.sessions
          : null;
  const estimate = estimateCampaign(c, w);
  const cac = ratio(estimate.spend, estimate.clients);
  const contribution =
    unitRevenue !== null && unitCost !== null ? unitRevenue - unitCost : null;
  const monthlyContribution =
    contribution === null
      ? null
      : (contribution * c.sessionsPerClientMonth * w.settings.attendancePct) /
        100;
  const contributionLtv =
    monthlyContribution === null
      ? null
      : monthlyContribution * c.retentionMonths;
  const payback =
    cac !== null && monthlyContribution !== null && monthlyContribution > 0
      ? cac / monthlyContribution
      : null;
  const without = forecast(
    { ...w, campaigns: w.campaigns.filter((x) => x.id !== c.id) },
    context,
    [],
    1,
    false,
  );
  let cumulative = 0,
    cashRequired = 0;
  let deficit = false,
    recovery: string | null = null;
  months.forEach((m, i) => {
    cumulative +=
      (m.values.retainedCash ?? 0) - (without[i]?.values.retainedCash ?? 0);
    if (cumulative < -0.01) {
      deficit = true;
      recovery = null;
    }
    cashRequired = Math.max(cashRequired, -cumulative);
    if (deficit && !recovery && cumulative >= 0) recovery = m.date;
  });
  return {
    forecast: {
      cac,
      unitRevenue,
      unitCost,
      contributionLtv,
      revenueLtv:
        unitRevenue === null
          ? null
          : ((unitRevenue *
              c.sessionsPerClientMonth *
              w.settings.attendancePct) /
              100) *
            c.retentionMonths,
      paybackMonths:
        payback !== null && payback <= c.retentionMonths
          ? payback + c.conversionDelayMonths + w.settings.collectionDelayMonths
          : null,
      cashRequired,
      recovery,
      incrementalProfit: months.reduce(
        (n, m, i) =>
          n + (m.values.profit ?? 0) - (without[i]?.values.profit ?? 0),
        0,
      ),
    },
    actual: {
      spend,
      clients,
      leads: sum("leads"),
      revenue,
      delivery,
      expenses,
      cac:
        spend !== null && expenses !== null && clients
          ? (spend + expenses) / clients
          : null,
      contribution:
        revenue !== null && delivery !== null ? revenue - delivery : null,
      netContribution:
        revenue !== null &&
        delivery !== null &&
        spend !== null &&
        expenses !== null
          ? revenue - delivery - spend - expenses
          : null,
    },
  };
}

export function initiativeActuals(
  proposal: Proposal,
  w: Workspace,
  months: ForecastMonth[],
  range: Range,
) {
  const campaignIds = new Set(
    proposal.changes
      .filter(
        (e) =>
          proposal.approvedIds.includes(e.id) &&
          e.field.startsWith("marketing."),
      )
      .map((e) => e.targetId),
  );
  const baseline = proposal.baseline as { after?: ForecastMonth[] } | null;
  const periods = finalizedPeriods(w, range).filter(
    (p) =>
      proposal.approvedAt &&
      p.start >=
        proposal.changes
          .filter((e) => proposal.approvedIds.includes(e.id))
          .reduce((date, e) => (e.date < date ? e.date : date), "9999-12-31"),
  );
  return [...campaignIds].map((id) => {
    const c = w.campaigns.find((c) => c.id === id);
    const entries = w.funnels.filter(
      (f) => f.campaignId === id && periods.some((p) => p.id === f.periodId),
    );
    const total = (key: "spend" | "leads" | "clients" | "attributedRevenue") =>
      entries.length && entries.every((f) => f[key] !== null)
        ? entries.reduce((n, f) => n + f[key]!, 0)
        : null;
    const expected = (
      series: ForecastMonth[],
      key: "spend" | "leads" | "clients",
    ) => {
      if (
        !periods.length ||
        !series.length ||
        periods.some(
          (p) =>
            p.start < series[0].date || p.end > monthEnd(series.at(-1)!.date),
        )
      )
        return null;
      let result = 0;
      for (const p of periods)
        for (const m of series) {
          const days = overlap(p, { start: m.date, end: monthEnd(m.date) });
          if (!days) continue;
          const value = m.channels[id]?.[key];
          if (value == null) return null;
          result += (value * days) / daysInclusive(m.date, monthEnd(m.date));
        }
      return result;
    };
    return {
      id,
      name: c?.name ?? "Archived campaign",
      periods: periods.length,
      actualSpend: total("spend"),
      actualLeads: total("leads"),
      actualClients: total("clients"),
      actualRevenue: total("attributedRevenue"),
      approvedLeads: expected(baseline?.after ?? [], "leads"),
      approvedClients: expected(baseline?.after ?? [], "clients"),
      currentClients: expected(months, "clients"),
    };
  });
}
