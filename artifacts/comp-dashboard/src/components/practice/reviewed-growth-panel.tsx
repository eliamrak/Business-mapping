import { GrowthInput } from "./growth-input";
import { GrowthHiringCard } from "./growth-hiring-card";
import { GrowthTrajectory } from "./growth-trajectory";
import type {
  ReviewedGrowth,
  GrowthSettings,
} from "../../lib/reviewed-growth-observations.ts";
const number = (n: number | null | undefined) =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
const month = (m: string) =>
  new Date(m + "-01T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
export function ReviewedGrowthPanel({
  model,
  settings,
  onChange,
  scenario = false,
  compact = false,
}: {
  model: ReviewedGrowth & { inputRevision?: string };
  settings: GrowthSettings;
  onChange: (s: GrowthSettings) => void;
  scenario?: boolean;
  compact?: boolean;
}) {
  const control = (
    label: string,
    key:
      | "occupancy"
      | "goalMonths"
      | "checkMonths"
      | "leadConsultDays"
      | "otherRouteDays"
      | "reserve",
    min: number,
    max: number,
    scale = 1,
  ) => (
    <label>
      {label}
      <GrowthInput
        type="number"
        min={min}
        max={max}
        step={key.includes("Months") ? 1 : "any"}
        value={settings[key] * scale}
        onChange={(e) => {
          if (e.target.value === "") return;
          const value = Number(e.target.value) / scale;
          if (
            !Number.isFinite(value) ||
            value < min / scale ||
            value > max / scale
          )
            return;
          const next = { ...settings, [key]: value };
          if (key === "goalMonths")
            next.checkMonths = Math.max(next.checkMonths, value);
          if (next.checkMonths < next.goalMonths) return;
          onChange(next);
        }}
      />
    </label>
  );
  return (
    <section
      className="pw-metric-panel pw-reviewed-growth"
      aria-label="Reviewed growth forecast"
    >
      <header>
        <h2>{scenario ? "Growth sandbox" : "Growth outlook"}</h2>
        <span>
          {model.cutoff
            ? `Whole practice · As of ${model.cutoff}`
            : "Awaiting covered attendance"}
        </span>
      </header>
      <p>
        {scenario
          ? "Hypothetical plan — actual records stay unchanged."
          : "Observed lead averages projected forward; estimates, not guarantees."}
      </p>
      {model.reason && <p role="status">{model.reason}</p>}
      <GrowthTrajectory cutoff={model.cutoff} actualMonths={model.actualMonths} families={model.families} settings={settings} onChange={onChange} />
      <GrowthHiringCard families={model.families} settings={settings} onChange={onChange} />
      <details><summary>Deep dive: model diagnostics and monthly values</summary>
      {model.reason ? (
        <p role="status">{model.reason}</p>
      ) : (
        <>
          <p>
            {model.stock?.established} established active clients ·{" "}
            {model.stock?.early} early starters
          </p>
          <p>
            Goal: {number(settings.occupancy * 100)}% occupancy by{" "}
            {model.families[0]?.months[settings.goalMonths - 1]
              ? month(model.families[0]!.months[settings.goalMonths - 1]!.month)
              : "the selected horizon"}{" "}
            · {number(model.families[0]?.capacity?.[settings.goalMonths - 1])} sessions / month
            capacity
          </p>
          <div className="pw-growth-table-wrap pw-growth-summary">
            <table>
              <caption className="sr-only">
                Recent and longer-history growth estimates
              </caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  {model.families.map((f) => (
                    <th scope="col" key={f.historyMonths}>
                      {f.historyMonths === 3
                        ? "Last 3 months"
                        : "Last 12 months"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Attendance months",
                    ...model.families.map(
                      (f) => `${f.coveredMonths} / ${f.historyMonths}`,
                    ),
                  ],
                  [
                    "Entered leads / month",
                    ...model.families.map(
                      (f) =>
                        `${number(f.standardLeadPace)} · ${f.leadMonths.length} months`,
                    ),
                  ],
                  [
                    "First-observed starts",
                    ...model.families.map((f) => number(f.starts)),
                  ],
                  [
                    "Projected sessions at goal month",
                    ...model.families.map((f) =>
                      number(f.projection?.workload[settings.goalMonths - 1]),
                    ),
                  ],
                  [
                    "Leads / month to reach goal",
                    ...model.families.map((f) =>
                      number(f.projection?.goalPace),
                    ),
                  ],
                  [
                    "Extra weekly capacity for goal pace",
                    ...model.families.map((f) =>
                      number(f.projection?.extraWeeklyCapacity),
                    ),
                  ],
                  [
                    "Feasible later goal within checked horizon",
                    ...model.families.map((f) =>
                      f.projection?.alternativeGoalMonths
                        ? `${f.projection.alternativeGoalMonths} months`
                        : "Not identified",
                    ),
                  ],
                  [
                    "Physical lead ceiling / month",
                    ...model.families.map((f) =>
                      number(f.projection?.physicalLeadCeiling),
                    ),
                  ],
                  [
                    "Practice capacity crossing",
                    ...model.families.map((f) =>
                      f.projection
                        ? f.projection.physicalCrossing
                          ? month(f.projection.physicalCrossing)
                          : "None in checked horizon"
                        : f.reason,
                    ),
                  ],
                  [
                    "Start recruiting by",
                    ...model.families.map((f) => {
                      if (!f.projection) return "Forecast unavailable";
                      if (!f.projection.physicalCrossing)
                        return "No crossing in checked horizon";
                      if (
                        settings.recruitmentMonths === null ||
                        settings.onboardingMonths === null ||
                        settings.rampMonths === null
                      )
                        return "Set recruitment, onboarding and ramp times";
                      const date = new Date(
                        f.projection.physicalCrossing + "-01T00:00:00Z",
                      );
                      date.setUTCDate(
                        date.getUTCDate() -
                          Math.ceil(
                            ((settings.recruitmentMonths +
                              settings.onboardingMonths +
                              settings.rampMonths) *
                              365.2425) /
                              12,
                          ),
                      );
                      return date.toISOString().slice(0, 10);
                    }),
                  ],
                ]
                  .filter(
                    ([label]) =>
                      !compact ||
                      [
                        "Entered leads / month",
                        "Projected sessions at goal month",
                        "Leads / month to reach goal",
                        "Physical lead ceiling / month",
                        "Start recruiting by",
                      ].includes(label as string),
                  )
                  .map(([label, ...values]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {values.map((v, i) => (
                        <td key={i}>{v}</td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {model.families.some((f) => f.provisional) && (
            <p>
              Lead totals include an incomplete month; estimates are
              provisional.
            </p>
          )}
          {model.families.some(
            (f) => f.projection?.goalStatus === "capacity-limited",
          ) && (
            <p role="status">
              The goal pace exceeds capacity somewhere in the checked path.
            </p>
          )}
          {!compact && (
            <div
              className="pw-growth-table-wrap"
              role="region"
              aria-label="Monthly trajectory; scroll horizontally for all months and values"
              tabIndex={0}
            >
              <table>
                <caption>Monthly trajectory · sessions</caption>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Recent</th>
                    <th scope="col">Longer</th>
                    <th scope="col">Capacity</th>
                    <th scope="col">Occupancy goal</th>
                    {scenario && <th scope="col">Future leads / month</th>}
                  </tr>
                </thead>
                <tbody>
                  {model.families[0]?.months.map((m, i) => (
                    <tr key={m.month}>
                      <th scope="row">{month(m.month)}</th>
                      {model.families.map((f) => (
                        <td key={f.historyMonths}>
                          {number(f.projection?.workload[i])}
                        </td>
                      ))}
                      <td>{number(model.families[0]?.capacity?.[i])}</td>
                      <td>
                        {number(
                          model.families[0]?.capacity?.[i] == null
                            ? null
                            : model.families[0]!.capacity![i]! *
                                settings.occupancy,
                        )}
                      </td>
                      {scenario && (
                        <td>
                          <GrowthInput
                            aria-label={`Future leads ${m.month}`}
                            type="number"
                            min="0"
                            step="any"
                            placeholder="Historical average"
                            value={settings.monthlyLeads?.[m.month] ?? ""}
                            onChange={(e) => {
                              const next = { ...settings.monthlyLeads };
                              if (e.target.value === "") delete next[m.month];
                              else if (Number(e.target.value) >= 0)
                                next[m.month] = Number(e.target.value);
                              else return;
                              onChange({ ...settings, monthlyLeads: next });
                            }}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      </details>
      <details>
        <summary>Planning settings and source details</summary>
        <div className="pw-reviewed-growth-controls">
          {control("Capacity check (months)", "checkMonths", 1, 36)}
        </div>
        {scenario && (
          <fieldset>
            <legend>Hypothetical clinician capacity</legend>
            {(settings.staffing ?? []).map((person, index) => (
              <div className="pw-reviewed-growth-controls" key={person.id}>
                <label>
                  Start month
                  <GrowthInput
                    type="month"
                    value={person.startMonth}
                    onChange={(e) => {
                      if (!/^\d{4}-\d{2}$/.test(e.target.value)) return;
                      onChange({
                        ...settings,
                        staffing: settings.staffing!.map((p, i) =>
                          i === index
                            ? { ...p, startMonth: e.target.value }
                            : p,
                        ),
                      });
                    }}
                  />
                </label>
                <label>
                  Weekly capacity
                  <GrowthInput
                    type="number"
                    min="0"
                    max="200"
                    value={person.weeklyCapacity}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (value >= 0 && value <= 200)
                        onChange({
                          ...settings,
                          staffing: settings.staffing!.map((p, i) =>
                            i === index ? { ...p, weeklyCapacity: value } : p,
                          ),
                        });
                    }}
                  />
                </label>
                <label>
                  Ramp months
                  <GrowthInput
                    type="number"
                    min="0"
                    max="60"
                    value={person.rampMonths}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (value >= 0 && value <= 60)
                        onChange({
                          ...settings,
                          staffing: settings.staffing!.map((p, i) =>
                            i === index ? { ...p, rampMonths: value } : p,
                          ),
                        });
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...settings,
                      staffing: settings.staffing!.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  Remove hypothetical clinician
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...settings,
                  staffing: [
                    ...(settings.staffing ?? []),
                    {
                      id: crypto.randomUUID(),
                      startMonth:
                        model.families[0]?.months[0]?.month ??
                        new Date().toISOString().slice(0, 7),
                      weeklyCapacity: 0,
                      rampMonths: 0,
                    },
                  ],
                })
              }
            >
              Add hypothetical clinician
            </button>
          </fieldset>
        )}
        <p>Lead-to-consult planning delay: 5 days. Extra reserve: 0 sessions. No-observed-consult delay: {settings.otherRouteDays} days (scenario assumption, not measured).</p>
        <p>
          Settings use the workspace save/review workflow. Standard uses
          observed lead averages; Sandbox overrides are separate. Capacity comes
          from configured clinician availability and working weeks/year.
        </p>
        <p>
          Established means three distinct treatment dates; active means the
          last treatment was less than 90 days ago. Earlier unimported history
          is unknown. Current established and early cohorts use separate
          flat-frequency estimates; future decay or transition is not modeled.
        </p>
        <p>
          Leads and starts are period aggregates, not linked-person
          probabilities. The waiting pipeline is estimated, not a recorded
          queue. The no-observed-consult delay is an illustrative assumption;
          try zero or the observed consult-route delay. Physical capacity and
          occupancy goal are different limits.
        </p>
        {model.families.map((f) => (
          <p key={f.historyMonths}>
            {f.historyMonths === 3 ? "Recent" : "Longer"}: leads through{" "}
            {f.leadMonths.at(-1) ?? "unavailable"}; latest complete lead month{" "}
            {f.latestCompleteLeadMonth ?? "unavailable"}. Entry timestamps are
            not recorded.{" "}
            {f.fallbackAges.length
              ? `Recent unsupported ages use longer-history follow-up from day ${Math.min(...f.fallbackAges)}.`
              : ""}{" "}
            {f.reason ?? ""}
          </p>
        ))}
        <p>
          Clinician-specific acquisition and capacity routing require recorded
          suitable-provider attribution. Practice totals do not guarantee each
          clinician can accept the projected demand. No forecast is asserted
          beyond the checked horizon.
        </p>
        <small>
          Formula {model.version} · source revision{" "}
          {model.inputRevision ?? "synthetic fixture"}
        </small>
      </details>
    </section>
  );
}
