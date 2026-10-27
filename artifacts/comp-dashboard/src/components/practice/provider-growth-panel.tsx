import { useState } from "react";
import type {
  ProviderGrowth,
  staffingPlanCandidates,
} from "../../lib/provider-growth.ts";
import type { GrowthSettings } from "../../lib/reviewed-growth-observations.ts";
const n = (v: number | null | undefined) =>
  v == null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v);
export function ProviderGrowthPanel({
  model,
  settings,
  onChange,
  scenario,
  staffingCandidates,
}: {
  model: ProviderGrowth;
  settings: GrowthSettings;
  onChange: (s: GrowthSettings) => void;
  scenario: boolean;
  staffingCandidates: ReturnType<typeof staffingPlanCandidates>;
}) {
  const [selected, setSelected] = useState("");
  const provider =
    model.rows.find((p) => String(p.id) === selected) ?? model.rows[0];
  const key = String(provider?.id ?? "");
  const plan = settings.providerPlans?.[key] ?? {
    usePracticeProxy: false,
    monthlyLeads: {},
    reserve: 0,
  };
  const setPlan = (value: typeof plan) =>
    onChange({
      ...settings,
      providerPlans: { ...settings.providerPlans, [key]: value },
    });
  return (
    <section
      className="pw-metric-panel pw-reviewed-growth pw-provider-growth"
      aria-label="Clinician growth history and planning"
    >
      <header>
        <h2>Clinician growth</h2>
        <span>Same cutoff: {model.cutoff ?? "Unknown"}</span>
      </header>
      {!provider ? (
        <p>Current clinician roster is unavailable.</p>
      ) : (
        <>
          <label>
            Clinician
            <select
              aria-label="Growth clinician"
              value={provider.id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {model.rows.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p>
            {n(provider.stock?.established)} established active ·{" "}
            {n(provider.stock?.early)} early clients ·{" "}
            {n(provider.weeklyCapacity)} configured sessions / working week
          </p>
          {provider.reason && <p role="status">{provider.reason}</p>}
          <div className="pw-growth-table-wrap pw-growth-summary">
            <table>
              <caption>Recorded history</caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">3 months</th>
                  <th scope="col">12 months</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Covered months",
                    ...provider.families.map(
                      (f) => `${f.coveredMonths}/${f.historyMonths}`,
                    ),
                  ],
                  [
                    "Attended sessions / calendar week",
                    ...provider.families.map((f) => n(f.weeklyAttendance)),
                  ],
                  [
                    "Average established active clients",
                    ...provider.families.map((f) =>
                      n(
                        f.coveredDays
                          ? f.establishedDays / f.coveredDays
                          : null,
                      ),
                    ),
                  ],
                  [
                    "Established sessions / client-week",
                    ...provider.families.map((f) =>
                      n(
                        f.establishedDays
                          ? (f.establishedVisits * 7) / f.establishedDays
                          : null,
                      ),
                    ),
                  ],
                  [
                    "First practice starts",
                    ...provider.families.map((f) => n(f.firstObservedStarts)),
                  ],
                  [
                    "Started with another clinician",
                    ...provider.families.map((f) => n(f.transferClients)),
                  ],
                  [
                    "Attributed leads / month",
                    ...provider.families.map((f) => n(f.standardLeadPace)),
                  ],
                ].map(([label, ...values]) => (
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
          <h3>Provider planning scenario</h3>
          {provider.families.some((f) => f.planningProvisional) && (
            <p>
              Lead totals include incomplete months; these estimates are
              provisional.
            </p>
          )}
          <label>
            <input
              type="checkbox"
              checked={plan.usePracticeProxy}
              onChange={(e) =>
                setPlan({ ...plan, usePracticeProxy: e.target.checked })
              }
            />
            Use practice-average response (proxy, not recorded provider
            conversion)
          </label>
          {plan.usePracticeProxy && (
            <p>
              Uses this clinician’s current stock, historical cadence and
              capacity. Future clients are assumed to behave like
              practice-average starters; pending pipeline is assumed zero.
              Suitability is unknown. This does not assign or route real
              clients.
            </p>
          )}
          <div className="pw-growth-table-wrap pw-growth-summary">
            <table>
              <caption>Conditional capacity estimate</caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Recent basis</th>
                  <th scope="col">Longer basis</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Response basis",
                    ...provider.families.map((f) =>
                      f.basis === "practice-proxy-scenario"
                        ? "Practice proxy scenario"
                        : f.basis === "provider-attributed-aggregate"
                          ? "Attributed period aggregates"
                          : "No attributed leads",
                    ),
                  ],
                  [
                    "Leads / month to occupancy goal",
                    ...provider.families.map((f) => n(f.projection?.goalPace)),
                  ],
                  [
                    "Physical lead ceiling / month",
                    ...provider.families.map((f) =>
                      n(f.projection?.physicalLeadCeiling),
                    ),
                  ],
                  [
                    "Capacity crossing",
                    ...provider.families.map((f) =>
                      f.projection
                        ? (f.projection.physicalCrossing ??
                          "None in checked horizon")
                        : "Unavailable",
                    ),
                  ],
                  [
                    "Service / specialty suitability",
                    ...provider.families.map(() => "Unknown — not verified"),
                  ],
                ].map(([label, ...values]) => (
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
          {[
            ...new Set(
              provider.families
                .filter((f) => !f.projection)
                .map((f) => f.planningReason)
                .filter(Boolean),
            ),
          ].map((reason) => (
            <p role="status" key={reason}>
              {reason}
            </p>
          ))}
          <label>
            Provider reserve (sessions / month)
            <input
              type="number"
              min="0"
              step="any"
              value={plan.reserve}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0)
                  setPlan({ ...plan, reserve: v });
              }}
            />
          </label>
          <details>
            <summary>Monthly lead allocation scenario</summary>
            <p>
              Blank uses the attributed historical average, or zero when the
              proxy is enabled. Entered allocations are hypothetical; they never
              become recorded leads.
            </p>
            <div
              className="pw-growth-table-wrap"
              role="region"
              aria-label="Provider lead allocations; scroll horizontally"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Leads assigned to this clinician</th>
                    <th scope="col">Modeled provider leads, recent / longer</th>
                    <th scope="col">Practice series, recent / longer</th>
                    <th scope="col">Constraint</th>
                  </tr>
                </thead>
                <tbody>
                  {provider.families[0]?.months.map((m, i) => {
                    const recent = model.allocation[0]?.months[i],
                      longer = model.allocation[1]?.months[i];
                    const exceeded =
                      recent?.overallocated || longer?.overallocated;
                    const overload = [
                      ...new Set([
                        ...(recent?.overloaded ?? []),
                        ...(longer?.overloaded ?? []),
                      ]),
                    ];
                    return (
                      <tr key={m.month}>
                        <th scope="row">{m.month}</th>
                        <td>
                          <input
                            aria-label={`Allocated leads ${provider.label} ${m.month}`}
                            type="number"
                            min="0"
                            step="any"
                            value={plan.monthlyLeads[m.month] ?? ""}
                            placeholder="Not assigned"
                            onChange={(e) => {
                              const next = { ...plan.monthlyLeads };
                              if (e.target.value === "") delete next[m.month];
                              else {
                                const v = Number(e.target.value);
                                if (!Number.isFinite(v) || v < 0) return;
                                next[m.month] = v;
                              }
                              setPlan({ ...plan, monthlyLeads: next });
                            }}
                          />
                        </td>
                        <td>
                          {n(recent?.modeled)} / {n(longer?.modeled)}
                          <small>
                            {n(recent?.assigned)} explicitly assigned;{" "}
                            {n(recent?.unmodeledProviders)} providers
                            unavailable
                          </small>
                        </td>
                        <td>
                          {n(recent?.practiceLeads)} /{" "}
                          {n(longer?.practiceLeads)}
                        </td>
                        <td>
                          {exceeded
                            ? "Allocations exceed practice series. "
                            : ""}
                          {overload.length
                            ? `Provider capacity exceeded: ${overload.join(", ")}.`
                            : "Suitability remains unknown."}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {scenario && (
        <details>
          <summary>Reconcile saved staffing plans</summary>
          <p>
            Hiring profiles are templates, not scheduled hires. Only uniquely
            mapped enabled hire events with whole-month timing are offered.
            Existing plans remain unchanged.
          </p>
          {staffingCandidates.overlays.map((o) => (
            <div key={o.id}>
              <span>
                {o.name}: {o.weeklyCapacity} weekly sessions, {o.startMonth},{" "}
                {o.rampMonths}-month ramp
              </span>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...settings,
                    staffing: [
                      ...(settings.staffing ?? []),
                      {
                        id: o.id,
                        startMonth: o.startMonth,
                        weeklyCapacity: o.weeklyCapacity,
                        rampMonths: o.rampMonths,
                      },
                    ],
                  })
                }
              >
                Use {o.name} in Growth overlay
              </button>
            </div>
          ))}
          {!staffingCandidates.overlays.length && (
            <p>No unambiguous unused hire events to add.</p>
          )}
          {staffingCandidates.issues.map((issue, i) => (
            <p key={i}>{issue}</p>
          ))}
        </details>
      )}
      <details>
        <summary>Attribution and reconciliation</summary>
        <p>
          Qualification uses three distinct treatment dates across the practice.
          Daily client ownership follows the latest treatment date; shared
          latest dates count once for practice and once for each participating
          clinician. Transfers are not new practice starts. These provider
          client counts must not be summed as unique practice clients.
        </p>
        <p>
          Current provider client pairs: {n(model.providerStockPairs)}; practice
          unique active clients:{" "}
          {model.practiceStock
            ? n(model.practiceStock.established + model.practiceStock.early)
            : "Unavailable"}
          . Attendance sessions reconcile by actual provider; client-day
          exposure can overlap for shared clients.
        </p>
        <p>
          Practice reserve is not automatically split; provider reserves are
          separate scenario inputs. Provider attribution is still an aggregate
          planning ratio, not a linked-person probability. Spare capacity in
          another clinician or a hypothetical hire is not automatically assigned
          here. Service, specialty and availability fit need separate
          verification.
        </p>
      </details>
    </section>
  );
}
