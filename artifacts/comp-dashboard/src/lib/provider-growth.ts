import { acquisitionFunnel } from "./acquisition-funnel.ts";
import type { Workspace, Context } from "@workspace/practice/hub";
import {
  reviewedGrowth,
  type GrowthObservationInput,
  type ReviewedGrowth,
} from "./reviewed-growth-observations.ts";
import { projectGrowth, type Response } from "./reviewed-growth-engine.ts";

export function providerGrowth(
  input: GrowthObservationInput,
  practice: ReviewedGrowth,
  providers: readonly { id: number; label: string; sessionsPerWeek: number }[],
) {
  const fullyAttributedPeriods = new Set(
    input.workspace.periods
      .filter((period) => {
        const rows = input.workspace.funnels.filter(
          (row) => row.periodId === period.id,
        );
        return (
          rows.length > 0 &&
          rows.every(
            (row) =>
              row.scope === "source" &&
              row.clinicianId !== null &&
              Number.isFinite(row.leads) &&
              row.leads !== null &&
              row.leads >= 0,
          ) &&
          acquisitionFunnel(
            {
              ...input.workspace,
              periods: input.workspace.periods.map((p) => ({
                ...p,
                funnelComplete: true,
              })),
            },
            [period.start.slice(0, 7)],
          ).leads !== null
        );
      })
      .map((period) => period.id),
  );
  const rows = providers.map((provider) => {
    const plan = input.settings.providerPlans?.[String(provider.id)];
    const workspace = {
      ...input.workspace,
      funnels: input.workspace.funnels.filter(
        (f) =>
          f.scope === "source" &&
          f.clinicianId === provider.id &&
          fullyAttributedPeriods.has(f.periodId),
      ),
    };
    const model = practice.cutoff
      ? reviewedGrowth({
          ...input,
          cutoff: practice.cutoff,
          clinicianIds: [provider.id],
          coverageClinicianIds: input.clinicianIds,
          workspace,
          weeklyCapacity: provider.sessionsPerWeek,
          scenario: false,
          settings: {
            ...input.settings,
            reserve: 0,
            staffing: undefined,
            monthlyLeads: undefined,
          },
        })
      : null;
    const families = (model?.families ?? []).map((family, index) => {
      const practiceFamily = practice.families[index];
      const partialAttributedRows = input.workspace.funnels.filter(
        (row) =>
          row.clinicianId === provider.id &&
          !fullyAttributedPeriods.has(row.periodId) &&
          input.workspace.periods.some(
            (period) =>
              period.id === row.periodId &&
              practice.cutoff &&
              period.end <= practice.cutoff,
          ),
      );
      const attributionIncomplete = partialAttributedRows.length > 0;
      const useProxy = !!plan?.usePracticeProxy;
      // Borrow only future-arrival response; the practice waiting pipeline is NOT
      // assigned to a clinician. Zero pending is an explicit proxy scenario.
      const response: Response | null =
        useProxy && practiceFamily?.response
          ? {
              ...practiceFamily.response,
              pipeline: family.months.map(() => 0),
              pendingStarts: 0,
            }
          : family.response;
      const leadSeries = family.months.map(
        (m) =>
          plan?.monthlyLeads[m.month] ??
          (useProxy ? 0 : (family.standardLeadPace ?? 0)),
      );
      const hasAttributedData = family.leadMonths.length > 0;
      const enabled = useProxy
        ? !!practiceFamily?.response && practiceFamily.evidenceValid
        : hasAttributedData;
      const projection =
        enabled &&
        family.evidenceValid &&
        response &&
        family.baseline &&
        family.capacity
          ? projectGrowth({
              months: family.months,
              response,
              baseline: family.baseline,
              capacity: family.capacity,
              reserve: family.months.map(() => plan?.reserve ?? 0),
              leads: leadSeries,
              occupancy: input.settings.occupancy,
              goalMonths: input.settings.goalMonths,
              workingWeeksPerMonth: input.weeksPerYear / 12,
            })
          : null;
      // Target solving does not supply observed or allocated future lead volume.
      // Prefer usable attributed response even when a proxy scenario was saved.
      const attributedResponse = hasAttributedData ? family.response : null;
      const targetResponse = attributedResponse ??
        (practiceFamily?.evidenceValid && practiceFamily.response
          ? { ...practiceFamily.response, pipeline: family.months.map(() => 0), pendingStarts: 0 }
          : null);
      const targetProjection = family.evidenceValid && targetResponse && family.baseline && family.capacity
        ? projectGrowth({
            months: family.months, response: targetResponse,
            baseline: family.baseline, capacity: family.capacity,
            reserve: family.months.map(() => plan?.reserve ?? 0),
            leads: family.months.map(() => 0), occupancy: input.settings.occupancy,
            goalMonths: input.settings.goalMonths, workingWeeksPerMonth: input.weeksPerYear / 12,
          }) : null;
      return {
        ...family,
        targetProjection,
        targetBasis: targetProjection ? (attributedResponse ? "provider-attributed-aggregate" : "practice-average-estimate") : "unavailable",
        targetProvisional: attributedResponse ? family.provisional : !!practiceFamily?.provisional,
        attributionIncomplete,
        planningProvisional: useProxy
          ? !!practiceFamily?.provisional
          : family.provisional,
        projection,
        leadSeries,
        basis: useProxy
          ? ("practice-proxy-scenario" as const)
          : hasAttributedData
            ? ("provider-attributed-aggregate" as const)
            : ("unavailable" as const),
        planningReason: projection
          ? null
          : !family.evidenceValid
            ? family.reason
            : useProxy
              ? "Practice response or provider baseline unavailable."
              : targetProjection
                ? "Future clinician lead volume is not recorded. Target estimates use practice averages; a trajectory needs allocated leads in Deep dive."
                : "Future clinician lead volume is not recorded. Target estimates are also unavailable: usable response or baseline evidence is missing.",
        suitability: "unknown" as const,
        pendingPipeline: useProxy
          ? "Zero pending pipeline assumed; not observed."
          : "Estimated from attributed aggregate history.",
      };
    });
    return {
      id: provider.id,
      label: provider.label,
      weeklyCapacity: provider.sessionsPerWeek,
      stock: model?.stock ?? null,
      actualMonths: model?.actualMonths ?? [],
      reason: model?.reason ?? practice.reason,
      families,
    };
  });
  const allocation = practice.families.map((family, index) => ({
    historyMonths: family.historyMonths,
    months: family.months.map((m, i) => {
      const modeled = rows.reduce(
        (sum, row) =>
          sum +
          (row.families[index]?.projection
            ? row.families[index]!.leadSeries[i]!
            : 0),
        0,
      );
      const unmodeledProviders = rows.filter(
        (row) => !row.families[index]?.projection,
      ).length;
      const assigned = rows.reduce(
        (sum, row) =>
          sum +
          (input.settings.providerPlans?.[String(row.id)]?.monthlyLeads[
            m.month
          ] ?? 0),
        0,
      );
      const practiceLeads = family.leadSeries?.[i] ?? null;
      const overloaded = rows
        .filter((row) => {
          const f = row.families[index];
          return (
            f?.projection &&
            f.capacity &&
            f.projection.workload[i]! +
              (input.settings.providerPlans?.[String(row.id)]?.reserve ?? 0) >
              f.capacity[i]! + 1e-9
          );
        })
        .map((row) => row.label);
      return {
        month: m.month,
        assigned,
        modeled,
        unmodeledProviders,
        practiceLeads,
        unassigned:
          practiceLeads === null ? null : Math.max(0, practiceLeads - modeled),
        overallocated:
          practiceLeads !== null &&
          (assigned > practiceLeads || modeled > practiceLeads),
        overloaded,
      };
    }),
  }));
  return {
    cutoff: practice.cutoff,
    rows,
    allocation,
    practiceStock: practice.stock,
    providerStockPairs: rows.every((r) => r.stock !== null)
      ? rows.reduce((s, r) => s + r.stock!.established + r.stock!.early, 0)
      : null,
    suitability: "unknown" as const,
  };
}
export type ProviderGrowth = ReturnType<typeof providerGrowth>;

/** Reconcile only saved, enabled clinician.hire events with unique template
 * identity. Hiring rows are templates, not decisions to hire every template. */
export function staffingPlanCandidates(
  workspace: Workspace,
  context: Context,
  existing: readonly { id: string }[],
) {
  const overlays: {
    id: string;
    name: string;
    startMonth: string;
    weeklyCapacity: number;
    rampMonths: number;
  }[] = [];
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const e of workspace.events.filter(
    (e) => e.enabled && e.field === "clinician.hire",
  )) {
    const key = `plan-event:${e.id}`;
    if (
      workspace.events.filter(
        (other) =>
          other.enabled &&
          other.field === "clinician.hire" &&
          other.id === e.id,
      ).length !== 1
    ) {
      issues.push(`${e.name}: duplicate event identity; review manually.`);
      continue;
    }
    ids.add(e.id);
    if (existing.some((o) => o.id === key)) continue;
    const targets = context.clinicians.filter(
      (p) => String(p.id) === e.targetId,
    );
    if (
      targets.length !== 1 ||
      e.dependsOn.length ||
      e.end !== null ||
      e.date.slice(8) !== "01"
    ) {
      issues.push(
        `${e.name}: template, dependency, end date or partial-month timing requires review.`,
      );
      continue;
    }
    const date = new Date(e.date + "T00:00:00Z");
    date.setUTCMonth(date.getUTCMonth() + e.delayMonths);
    const candidateMonth = date.toISOString().slice(0, 7);
    if (
      existing.some((o) => {
        const item = o as {
          id: string;
          startMonth?: string;
          weeklyCapacity?: number;
          rampMonths?: number;
        };
        return (
          !item.id.startsWith("plan-event:") &&
          item.startMonth === candidateMonth &&
          item.weeklyCapacity === e.value &&
          item.rampMonths === e.rampMonths
        );
      })
    ) {
      issues.push(
        `${e.name}: a matching unlinked overlay already exists; reconcile manually to avoid double counting.`,
      );
      continue;
    }
    overlays.push({
      id: key,
      name: e.name,
      startMonth: date.toISOString().slice(0, 7),
      weeklyCapacity: e.value,
      rampMonths: e.rampMonths,
    });
  }
  return {
    overlays,
    issues,
    templateCount: workspace.hiring.filter((h) => !h.archived).length,
  };
}
