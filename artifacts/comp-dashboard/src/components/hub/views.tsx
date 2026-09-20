import { useState } from "react";
import {
  ArrowRight,
  Download,
  Info,
  Plus,
  Settings2,
  Check,
  CalendarDays,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  forecast,
  observed,
  metrics,
  registeredMetrics,
  metricMap,
  estimateCampaign,
  solveGoal,
  evaluateRules,
  evaluateObservedRules,
  monthDate,
  monthEnd,
  budgetAmount,
  type Workspace,
  type Context,
  type ForecastMonth,
  type Values,
  type Collection,
  type PlanEvent,
} from "@workspace/practice/hub";
import { calculateClinicianMetrics } from "@workspace/practice/compensation";
import { exportCsv } from "@/lib/hub-api";
import Affordability from "./affordability";
import { CategoryReport, CampaignEconomics } from "./financial-reports";
import GoalSearchView from "./goal-search";
export const fmt = (value: number | null | undefined, unit = "number") =>
  value == null
    ? "--"
    : unit === "currency"
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(value)
      : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}${unit === "percent" ? "%" : ""}`;
export const monthLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
export type ViewProps = {
  workspace: Workspace;
  context: Context;
  months: ForecastMonth[];
  range: { start: string; end: string };
  edit: (collection: Collection, record?: Record<string, unknown>) => void;
  settings: (section: string) => void;
  save: (workspace: Workspace, action: string) => Promise<void>;
  table: (collection: Collection) => React.ReactNode;
};
export function StatStrip({
  values,
  keys,
}: {
  values: Values;
  keys: string[];
}) {
  return (
    <div className="hub-stats">
      {keys.map((key) => (
        <div key={key}>
          <span>{metricMap[key]?.label ?? key}</span>
          <strong>{fmt(values[key], metricMap[key]?.unit)}</strong>
        </div>
      ))}
    </div>
  );
}
export function Warnings({ items }: { items: string[] }) {
  return items.length ? (
    <details className="hub-warnings">
      <summary>
        <Info />
        {items.length} assumption / data{" "}
        {items.length === 1 ? "notice" : "notices"}
      </summary>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  ) : null;
}
export function ForecastChart({ months }: { months: ForecastMonth[] }) {
  return (
    <div
      className="hub-chart"
      role="img"
      aria-label="Monthly forecast of revenue, operating profit, family take-home and available cash"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={months.map((m) => ({
            month: monthLabel(m.date),
            Revenue: m.values.revenue,
            Profit: m.values.profit,
            "Family take-home": m.values.familyTakeHome,
            Cash: m.values.cash,
          }))}
        >
          <CartesianGrid stroke="var(--pr-line)" vertical={false} />
          <XAxis
            dataKey="month"
            minTickGap={40}
            tick={{ fontSize: 11, fill: "var(--pr-muted)" }}
          />
          <YAxis
            width={60}
            tickFormatter={(v) => `${Math.round(v / 1000)}k`}
            tick={{ fontSize: 11, fill: "var(--pr-muted)" }}
          />
          <Tooltip
            contentStyle={{
              background: "var(--pr-bg)",
              borderColor: "var(--pr-line)",
              color: "var(--pr-text)",
            }}
            formatter={(v) => fmt(Number(v), "currency")}
          />
          <Legend iconType="plainline" />
          <Line
            type="monotone"
            dataKey="Revenue"
            stroke="#76b894"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="Profit"
            stroke="#dfae73"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="Family take-home"
            stroke="#cc8da9"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="Cash"
            stroke="#7faaba"
            dot={false}
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
export function ForecastTable({
  months,
  keys = [
    "sessions",
    "revenue",
    "clinicianPay",
    "overhead",
    "profit",
    "cash",
    "familyTakeHome",
  ],
}: {
  months: ForecastMonth[];
  keys?: string[];
}) {
  return (
    <div className="pr-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Month</th>
            {keys.map((key) => (
              <th key={key}>{metricMap[key]?.label ?? key}</th>
            ))}
            <th>Constraint</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.date}>
              <td>{monthLabel(m.date)}</td>
              {keys.map((key) => (
                <td key={key}>{fmt(m.values[key], metricMap[key]?.unit)}</td>
              ))}
              <td>{m.constraint}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Overview(props: ViewProps) {
  const { workspace, context, months, range } = props;
  const actual = observed(workspace, context, range.start, range.end);
  const [month, setMonth] = useState(0),
    [trace, setTrace] = useState<string | null>(null);
  const f = months[Math.min(month, months.length - 1)],
    signals = evaluateRules(workspace, months);
  const observedSignals = evaluateObservedRules(workspace, context);
  return (
    <>
      <div className="hub-section-heading">
        <div>
          <h2>Recorded position</h2>
          <p className="hub-muted">
            Finalized financial actuals / through{" "}
            {actual.dataThrough ?? "not yet finalized"}
          </p>
        </div>
        <a
          href={`${import.meta.env.BASE_URL}hub/updates`}
          className="pr-button"
        >
          <CalendarDays />
          Updates
        </a>
      </div>
      <StatStrip
        values={actual.values}
        keys={["collections", "sessions", "profit", "cash"]}
      />
      <Warnings items={actual.warnings} />
      <div className="hub-section-heading">
        <h2>Expected position</h2>
        <select
          aria-label="Forecast month"
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
        >
          {months.map((m, i) => (
            <option key={m.date} value={i}>
              {monthLabel(m.date)}
            </option>
          ))}
        </select>
      </div>
      <StatStrip
        values={f.values}
        keys={["revenue", "profit", "familyTakeHome", "cash"]}
      />
      <ForecastChart months={months} />
      <Warnings items={f.warnings} />
      <div className="hub-columns">
        <section>
          <h2>Goals</h2>
          {workspace.goals.filter((g) => !g.archived).length ? (
            <div className="hub-goals">
              {workspace.goals
                .filter((g) => !g.archived)
                .map((g) => {
                  const expected = months.find(
                      (m) => m.date.slice(0, 7) === g.date.slice(0, 7),
                    )?.values[g.metric],
                    target = g.amount / (g.basis === "annual" ? 12 : 1);
                  return (
                    <div key={g.id}>
                      <div>
                        <strong>{g.name}</strong>
                        <small>
                          {monthLabel(monthDate(g.date))} / monthly equivalent
                        </small>
                      </div>
                      <span>
                        {fmt(expected, metricMap[g.metric]?.unit)} /{" "}
                        {fmt(target, metricMap[g.metric]?.unit)}
                      </span>
                      <progress
                        value={Math.max(0, expected ?? 0)}
                        max={target || 1}
                      />
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="hub-muted">No goals set.</p>
          )}
        </section>
        <section>
          <h2>Decision signals</h2>
          {signals.length ? (
            signals.map((s) => (
              <div className="hub-signal" key={s.rule.id}>
                <span className={`hub-status ${s.status}`}>{s.status}</span>
                <strong>{s.rule.name}</strong>
                <p>{s.rule.action}</p>
                <small>
                  Recorded:{" "}
                  {observedSignals.find((x) => x.rule.id === s.rule.id)
                    ?.status ?? "unknown"}
                  .{" "}
                  {s.date
                    ? `Forecast: ${monthLabel(s.date)} / begin action ${monthLabel(s.actionDate!)}`
                    : "No trigger in this forecast"}
                </small>
              </div>
            ))
          ) : (
            <p className="hub-muted">No enabled decision rules.</p>
          )}
        </section>
      </div>
      <div className="hub-section-heading">
        <h2>Connected metrics</h2>
      </div>
      <div className="pr-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Actual selected range</th>
              <th>Forecast {monthLabel(f.date)}</th>
              <th>Basis</th>
            </tr>
          </thead>
          <tbody>
            {registeredMetrics(workspace).map(([key, label, unit]) => (
              <tr key={key}>
                <td>{label}</td>
                <td>{fmt(actual.values[key], unit)}</td>
                <td>{fmt(f.values[key], unit)}</td>
                <td>
                  <button
                    className="pr-icon"
                    aria-label={`Calculation for ${label}`}
                    title="Calculation basis"
                    onClick={() => setTrace(trace === key ? null : key)}
                  >
                    <Info />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {trace && (
        <section className="hub-trace">
          <h3>{metricMap[trace]?.label}</h3>
          <p>
            {f.trace[trace] ??
              `${metricMap[trace]?.label} is derived from the shared ${metricMap[trace]?.group.toLowerCase()} model for ${monthLabel(f.date)}. Missing inputs remain unavailable.`}
          </p>
        </section>
      )}
    </>
  );
}

export function Finances(props: ViewProps) {
  const { workspace, months, range, table, settings } = props;
  const [tab, setTab] = useState("budgets"),
    [month, setMonth] = useState(0);
  const m = months[Math.min(month, months.length - 1)];
  const actualPeriods = workspace.periods.filter(
    (p) =>
      !p.archived &&
      p.status === "finalized" &&
      p.start >= range.start &&
      p.end <= range.end,
  );
  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ["budgets", "Budgets & overhead"],
          ["actuals", "Actual spending"],
          ["money", "Money & family"],
          ["categories", "Categories"],
        ]}
      />
      {tab === "budgets" ? (
        <>
          <StatStrip
            values={m.values}
            keys={["overhead", "staffCost", "marketing", "breakEvenSessions"]}
          />
          {table("budgets")}
          <CategoryReport {...props} />
          <p className="hub-muted">
            Campaign costs ({fmt(m.values.marketing, "currency")}) and support
            payroll ({fmt(m.values.staffCost, "currency")}) are separate from
            these budget lines.
          </p>
        </>
      ) : tab === "actuals" ? (
        table("transactions")
      ) : tab === "categories" ? (
        table("categories")
      ) : (
        <>
          <div className="hub-section-heading">
            <h2>Money flow / {monthLabel(m.date)}</h2>
            <button className="pr-button" onClick={() => settings("money")}>
              <Settings2 />
              Money settings
            </button>
          </div>
          <div className="hub-waterfall">
            {[
              "collections",
              "clinicianPay",
              "employerBurden",
              "staffCost",
              "overhead",
              "marketing",
              "fees",
              "ownerPayroll",
              "profit",
              "taxReserve",
              "reserves",
              "distributions",
              "retainedCash",
              "familyTakeHome",
            ].map((key) => (
              <div key={key}>
                <span>{metricMap[key].label}</span>
                <strong>{fmt(m.values[key], "currency")}</strong>
              </div>
            ))}
          </div>
          <p className="hub-muted">
            Forecast estimates. Tax and withholding percentages are your
            assumptions. Owner clinical pay is already included in clinician
            compensation.
          </p>
          {table("allocations")}
        </>
      )}
    </>
  );
}

export function PracticeOperations(props: ViewProps) {
  const [tab, setTab] = useState("clinicians");
  return (
    <>
      <div className="hub-actions hub-link-row">
        <a className="pr-button" href={`${import.meta.env.BASE_URL}practice`}>
          Session tracker
          <ArrowRight />
        </a>
        <a className="pr-button" href={`${import.meta.env.BASE_URL}?view=team`}>
          Compensation & staff
          <ArrowRight />
        </a>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ["clinicians", "Operating roster"],
          ["terms", "Dated pay & rates"],
          ["rooms", "Rooms"],
          ["locations", "Locations"],
        ]}
      />
      <StatStrip
        values={props.months[0].values}
        keys={["capacity", "utilization", "roomCapacity", "roomUtilization"]}
      />
      {props.table(tab as Collection)}
      {tab === "rooms" && (
        <Warnings
          items={props.months[0].warnings.filter((w) =>
            w.toLowerCase().includes("room"),
          )}
        />
      )}
    </>
  );
}

export function Growth(props: ViewProps) {
  const { workspace, months, table, edit, context } = props;
  const [tab, setTab] = useState("campaigns"),
    [hire, setHire] = useState("");
  const hiring =
    workspace.hiring.find((h) => h.id === hire) ?? workspace.hiring[0];
  let hiringMonths: ForecastMonth[] = [];
  let payback: string | null = null,
    requiredCash = 0;
  if (hiring) {
    const event: PlanEvent = {
      id: hiring.id,
      name: hiring.name,
      date: hiring.start,
      end: null,
      field: "clinician.hire",
      targetId: String(hiring.templateClinicianId),
      value: hiring.desiredWeeklySessions,
      enabled: true,
      dependsOn: [],
      delayMonths: hiring.delayMonths,
      rampMonths: hiring.rampMonths,
      oneTimeCost:
        hiring.recruiting +
        hiring.credentialing +
        hiring.training +
        hiring.equipment +
        hiring.preCaseloadPay,
      monthlyCost: hiring.monthlySupport,
      notes: hiring.notes,
      initiativeId: null,
    };
    hiringMonths = forecast(workspace, context, [event]);
    let cumulative = 0;
    for (let i = 0; i < hiringMonths.length; i++) {
      cumulative +=
        (hiringMonths[i].values.retainedCash ?? 0) -
        (months[i].values.retainedCash ?? 0);
      requiredCash = Math.max(requiredCash, -cumulative);
      if (
        !payback &&
        hiringMonths[i].date >= hiring.start &&
        cumulative >= 0 &&
        i > 0
      )
        payback = hiringMonths[i].date;
    }
  }
  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ["campaigns", "Campaigns"],
          ["funnels", "Lead-generation actuals"],
          ["economics", "Campaign economics"],
          ["hiring", "Hiring economics"],
        ]}
      />
      {tab === "campaigns" ? (
        <>
          <StatStrip
            values={months[0].values}
            keys={["marketing", "leads", "clients", "cac"]}
          />
          {table("campaigns")}
          <div className="hub-section-heading">
            <h2>Acquisition model / monthly</h2>
          </div>
          <div className="pr-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Method</th>
                  <th>Spend</th>
                  <th>Leads</th>
                  <th>New clients</th>
                  <th>Lead basis</th>
                </tr>
              </thead>
              <tbody>
                {workspace.campaigns
                  .filter((c) => !c.archived)
                  .map((c) => {
                    const f = estimateCampaign(c, workspace);
                    return (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>{c.method}</td>
                        <td>{fmt(f.spend, "currency")}</td>
                        <td>{fmt(f.leads)}</td>
                        <td>{fmt(f.clients)}</td>
                        <td>
                          {f.inferredLeads
                            ? "Inferred from CAC / funnel"
                            : f.leads === null
                              ? "Unknown"
                              : "Calculated / entered"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <Warnings items={months[0].warnings} />
        </>
      ) : tab === "economics" ? (
        <CampaignEconomics {...props} />
      ) : tab === "funnels" ? (
        table("funnels")
      ) : (
        <>
          {table("hiring")}
          <Affordability {...props} />
          {hiring && (
            <>
              <div className="hub-section-heading">
                <h2>Hiring impact</h2>
                <select
                  aria-label="Hiring profile"
                  value={hiring.id}
                  onChange={(e) => setHire(e.target.value)}
                >
                  {workspace.hiring.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
                <button
                  className="pr-button"
                  onClick={() =>
                    edit("events", {
                      id: crypto.randomUUID(),
                      name: hiring.name,
                      date: hiring.start,
                      end: null,
                      field: "clinician.hire",
                      targetId: String(hiring.templateClinicianId),
                      value: hiring.desiredWeeklySessions,
                      enabled: true,
                      dependsOn: [],
                      delayMonths: hiring.delayMonths,
                      rampMonths: hiring.rampMonths,
                      oneTimeCost:
                        hiring.recruiting +
                        hiring.credentialing +
                        hiring.training +
                        hiring.equipment +
                        hiring.preCaseloadPay,
                      monthlyCost: hiring.monthlySupport,
                      notes: hiring.notes,
                      initiativeId: null,
                    })
                  }
                >
                  <Plus />
                  Plan this hire
                </button>
              </div>
              <div className="hub-stats">
                <div>
                  <span>Additional cash required</span>
                  <strong>{fmt(requiredCash, "currency")}</strong>
                </div>
                <div>
                  <span>Cumulative payback</span>
                  <strong>
                    {payback ? monthLabel(payback) : "Not reached"}
                  </strong>
                </div>
                <div>
                  <span>Cash available now</span>
                  <strong>
                    {fmt(
                      workspace.settings.openingCash -
                        workspace.settings.minimumCash,
                      "currency",
                    )}
                  </strong>
                </div>
              </div>
              <ForecastTable
                months={hiringMonths}
                keys={[
                  "sessions",
                  "clinicianPay",
                  "profit",
                  "cash",
                  "familyTakeHome",
                ]}
              />
            </>
          )}
        </>
      )}
    </>
  );
}

export function Plans(props: ViewProps) {
  const { workspace, context, months, table, settings } = props;
  const [tab, setTab] = useState("forecast"),
    [metric, setMetric] = useState("revenue"),
    [target, setTarget] = useState(50000),
    [exportError, setExportError] = useState("");
  const solution = solveGoal(workspace, context, metric, target);
  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ["forecast", "Active forecast"],
          ["events", "Plan events"],
          ["goals", "Goals & solver"],
        ]}
      />
      {tab === "forecast" ? (
        <>
          <div className="hub-section-heading">
            <h2>{months.length}-month forecast</h2>
            <div className="hub-actions">
              <button
                className="pr-button"
                onClick={() => settings("forecast")}
              >
                <Settings2 />
                Assumptions
              </button>
              <button
                className="pr-icon"
                aria-label="Export forecast CSV"
                title="Export forecast CSV"
                onClick={() =>
                  void exportCsv(
                    months.map((m) => ({ month: m.date, ...m.values })),
                  ).catch((e) => setExportError(e.message))
                }
              >
                <Download />
              </button>
            </div>
          </div>
          <ForecastChart months={months} />
          {exportError && (
            <p className="pr-error" role="alert">
              {exportError}
            </p>
          )}
          <Warnings items={[...new Set(months.flatMap((m) => m.warnings))]} />
          <ForecastTable months={months} />
          <a className="pr-text-link" href={`${import.meta.env.BASE_URL}`}>
            Original scenarios, comparisons and growth plans
            <ArrowRight />
          </a>
        </>
      ) : tab === "events" ? (
        table("events")
      ) : (
        <>
          {table("goals")}
          <GoalSearchView {...props} />
          <details className="hub-details">
            <summary>Quick steady-state estimate</summary>
            <section className="hub-solver">
              <h2>Work backward from a monthly goal</h2>
              <div className="hub-form-grid">
                <label className="pr-field">
                  Goal
                  <select
                    value={metric}
                    onChange={(e) => setMetric(e.target.value)}
                  >
                    {["sessions", "revenue", "profit", "familyTakeHome"].map(
                      (key) => (
                        <option value={key} key={key}>
                          {metricMap[key].label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="pr-field">
                  Monthly target
                  <input
                    type="number"
                    min="0"
                    value={target}
                    onChange={(e) => setTarget(Number(e.target.value))}
                  />
                </label>
              </div>
              <div className="hub-stats">
                {Object.entries(solution)
                  .filter(([key]) => key !== "warning")
                  .map(([key, value]) => (
                    <div key={key}>
                      <span>{key}</span>
                      <strong>
                        {fmt(
                          value as number | null,
                          key === "spend" ? "currency" : "number",
                        )}
                      </strong>
                    </div>
                  ))}
              </div>
              <p className="hub-muted">{solution.warning}</p>
            </section>
          </details>
        </>
      )}
    </>
  );
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: string[][];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="hub-tabs" role="tablist">
      {items.map(([key, label]) => (
        <button
          key={key}
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
