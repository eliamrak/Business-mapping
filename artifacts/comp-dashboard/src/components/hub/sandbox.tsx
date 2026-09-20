import { useEffect, useState, useRef } from "react";
import {
  Plus,
  Save,
  Check,
  Pencil,
  Copy,
  Pause,
  Play,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  forecast,
  eventIssues,
  metrics,
  registeredMetrics,
  metricMap,
  observed,
  forecastForPeriods,
  transitionInitiative,
  evaluateRules,
  initiativeActuals,
  type Proposal,
  type PlanEvent,
  type Workspace,
} from "@workspace/practice/hub";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import RecordEditor from "./record-editor";
import { newRecord } from "./config";
import { useUnsaved } from "./use-unsaved";
import {
  ForecastChart,
  Warnings,
  fmt,
  monthLabel,
  type ViewProps,
} from "./views";

export default function Sandbox(
  props: ViewProps & {
    theme: string;
    approve: (id: string, ids: string[]) => Promise<void>;
  },
) {
  const { workspace, context, months, save, theme, approve } = props;
  const [selected, setSelected] = useState(""),
    [draft, setDraft] = useState<Proposal | null>(null),
    [editing, setEditing] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [review, setReview] = useState(false),
    [month, setMonth] = useState(0),
    [group, setGroup] = useState("changed"),
    [variant, setVariant] = useState("expected"),
    [approveIds, setApproveIds] = useState<string[]>([]),
    [solo, setSolo] = useState("");
  const saved =
    workspace.proposals.find((p) => p.id === selected) ??
    workspace.proposals.find((p) => !p.archived);
  const previousSaved = useRef(saved);
  useEffect(() => {
    setDraft((current) => {
      const previous = previousSaved.current;
      previousSaved.current = saved;
      if (
        current?.id === saved?.id &&
        JSON.stringify(current) !== JSON.stringify(previous)
      )
        return current;
      return saved ? structuredClone(saved) : null;
    });
    setSolo("");
  }, [saved]);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  useUnsaved(dirty);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);
  const changes =
    draft?.changes.filter((c) => c.enabled && (!solo || c.id === solo)) ?? [];
  const multiplier = draft
    ? (variant === "conservative"
        ? draft.cases.conservative
        : variant === "optimistic"
          ? draft.cases.optimistic
          : draft.cases.expected) / 100
    : 1;
  const proposed =
    draft && !draft.approvedAt
      ? forecast(workspace, context, changes, multiplier)
      : months;
  const index = Math.min(month, months.length - 1),
    before = months[index],
    after = proposed[index];
  const issues = eventIssues([...workspace.events, ...changes]);
  const pairedBaseline =
    multiplier === 1 ? months : forecast(workspace, context, [], multiplier);
  const deltas = proposed.map((m, i) => ({
    date: m.date,
    profit: (m.values.profit ?? 0) - (pairedBaseline[i].values.profit ?? 0),
    cash: (m.values.cash ?? 0) - (pairedBaseline[i].values.cash ?? 0),
  }));
  const launched = deltas.filter((m) =>
    changes.some((c) => c.date <= m.date.slice(0, 7) + "-31"),
  );
  const firstDeficit = launched.findIndex((m) => m.cash < -0.01);
  const recovered =
    firstDeficit < 0
      ? null
      : launched.slice(firstDeficit + 1).find((m) => m.cash >= 0)?.date;
  const signals = evaluateRules(workspace, proposed);
  const currentSignals = evaluateRules(workspace, pairedBaseline);
  async function saveDraft() {
    if (!draft) return;
    setPending(true);
    setError("");
    try {
      await save(
        {
          ...workspace,
          proposals: workspace.proposals.map((p) =>
            p.id === draft.id ? draft : p,
          ),
        },
        `Save proposal: ${draft.name}`,
      );
      previousSaved.current = draft;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setPending(false);
    }
  }
  async function apply() {
    if (!draft) return;
    setPending(true);
    try {
      await approve(draft.id, approveIds);
      setReview(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed.");
    } finally {
      setPending(false);
    }
  }
  const baseline = draft?.baseline as {
    after?: typeof months;
    before?: typeof months;
  } | null;
  const actual = observed(
    workspace,
    context,
    props.range.start,
    props.range.end,
  );
  const actualPeriods = workspace.periods.filter(
    (p) =>
      !p.archived &&
      p.status === "finalized" &&
      p.start >= props.range.start &&
      p.end <= props.range.end,
  );
  const initiativeResults = draft?.approvedAt
    ? initiativeActuals(draft, workspace, months, props.range)
    : [];
  const approvedActualRange = forecastForPeriods(
    baseline?.after ?? [],
    actualPeriods,
  );
  const changeRows = registeredMetrics(workspace).filter(
    ([key, , , g]) =>
      group === "all" ||
      (group === "changed"
        ? Math.abs((after.values[key] ?? 0) - (before.values[key] ?? 0)) >
          0.0001
        : g === group),
  );
  return (
    <>
      <div className="hub-section-heading">
        <div className="hub-actions">
          <select
            aria-label="Proposal"
            value={saved?.id ?? ""}
            onChange={(e) => {
              if (dirty) {
                setError("Save this draft before switching proposals.");
                return;
              }
              setSelected(e.target.value);
            }}
          >
            <option value="" disabled>
              Select proposal
            </option>
            {workspace.proposals
              .filter((p) => !p.archived)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} / {p.status}
                </option>
              ))}
          </select>
          <button className="pr-button" onClick={() => props.edit("proposals")}>
            <Plus />
            Proposal
          </button>
        </div>
        {draft && (
          <div className="hub-actions">
            <button
              className="pr-icon"
              aria-label="Rename proposal"
              title="Rename proposal"
              onClick={() =>
                props.edit(
                  "proposals",
                  draft as unknown as Record<string, unknown>,
                )
              }
            >
              <Pencil />
            </button>
            <button
              className="pr-icon"
              aria-label="Duplicate proposal"
              title="Duplicate proposal"
              onClick={() => {
                const copy = structuredClone(draft);
                const map = new Map(
                  copy.changes.map((c) => [c.id, crypto.randomUUID()]),
                );
                copy.id = crypto.randomUUID();
                copy.name += " (copy)";
                copy.status = "draft";
                copy.approvedAt = null;
                copy.approvedIds = [];
                copy.baseline = null;
                copy.changes = copy.changes.map((c) => ({
                  ...c,
                  id: map.get(c.id)!,
                  dependsOn: c.dependsOn.map((id) => map.get(id) ?? id),
                  initiativeId: null,
                }));
                props.edit(
                  "proposals",
                  copy as unknown as Record<string, unknown>,
                );
              }}
            >
              <Copy />
            </button>
            {!draft.approvedAt && (
              <>
                <button
                  className="pr-icon"
                  title="Discard unsaved proposal changes"
                  aria-label="Discard unsaved proposal changes"
                  disabled={!dirty || pending}
                  onClick={() => {
                    if (window.confirm("Discard unsaved proposal changes?")) {
                      setDraft(saved ? structuredClone(saved) : null);
                      setError("");
                    }
                  }}
                >
                  <Undo2 />
                </button>
                <button
                  className="pr-button"
                  disabled={!dirty || pending}
                  onClick={() => void saveDraft()}
                >
                  <Save />
                  {pending ? "Saving..." : "Save draft"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {!draft ? (
        <div className="pr-empty">
          <h2>No proposals yet</h2>
          <button
            className="pr-button pr-primary"
            onClick={() => props.edit("proposals")}
          >
            <Plus />
            New proposal
          </button>
        </div>
      ) : (
        <>
          <div className="hub-sandbox-grid">
            <section className="hub-changes">
              <div className="hub-section-heading">
                <h2>Proposed changes</h2>
                {!draft.approvedAt && (
                  <button
                    className="pr-icon"
                    aria-label="Add change"
                    title="Add change"
                    onClick={() =>
                      setEditing(
                        newRecord(
                          "events",
                          workspace,
                          workspace.settings.forecastStart,
                        ),
                      )
                    }
                  >
                    <Plus />
                  </button>
                )}
              </div>
              <span className="hub-status">
                {dirty ? "Unsaved draft" : draft.status}
              </span>
              {draft.changes.map((change) => (
                <div className="hub-change" key={change.id}>
                  <label className="hub-checkbox">
                    <input
                      type="checkbox"
                      disabled={!!draft.approvedAt}
                      checked={change.enabled}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          changes: draft.changes.map((c) =>
                            c.id === change.id
                              ? { ...c, enabled: e.target.checked }
                              : c,
                          ),
                        })
                      }
                    />
                    <strong>{change.name}</strong>
                  </label>
                  <small>
                    {change.field} / {change.date}
                  </small>
                  <div>
                    <span>{fmt(change.value)}</span>
                    {!draft.approvedAt && (
                      <div className="hub-actions">
                        <button
                          className="pr-icon"
                          title="Edit change"
                          aria-label={`Edit change ${change.name}`}
                          onClick={() =>
                            setEditing(
                              change as unknown as Record<string, unknown>,
                            )
                          }
                        >
                          <Pencil />
                        </button>
                        <button
                          className="pr-icon"
                          title="Remove draft change"
                          aria-label={`Remove change ${change.name}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              changes: draft.changes.filter(
                                (c) => c.id !== change.id,
                              ),
                            })
                          }
                        >
                          <Trash2 />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {draft.approvedAt ? (
                <div className="hub-actions">
                  <button
                    className="pr-button"
                    disabled={
                      pending || ["completed", "stopped"].includes(draft.status)
                    }
                    onClick={() => {
                      const pause = draft.status !== "paused";
                      const date = new Date().toISOString().slice(0, 10);
                      if (
                        !window.confirm(
                          `${pause ? "Pause" : "Resume"} this initiative from ${date}? Earlier plan segments and the approved baseline will be retained.`,
                        )
                      )
                        return;
                      void save(
                        transitionInitiative(
                          workspace,
                          draft.id,
                          pause ? "paused" : "active",
                          date,
                          () => crypto.randomUUID(),
                        ),
                        `${pause ? "Pause" : "Resume"} initiative: ${draft.name}`,
                      ).catch((e) => setError(e.message));
                    }}
                  >
                    {draft.status === "paused" ? <Play /> : <Pause />}
                    {draft.status === "paused"
                      ? "Resume initiative"
                      : "Pause initiative"}
                  </button>
                  {["completed", "stopped"].map((status) => (
                    <button
                      key={status}
                      className="pr-button"
                      disabled={pending || draft.status === status}
                      onClick={() => {
                        const date = new Date().toISOString().slice(0, 10);
                        if (
                          window.confirm(
                            `Mark this initiative ${status} and end its remaining plan effects from ${date}?`,
                          )
                        )
                          void save(
                            transitionInitiative(
                              workspace,
                              draft.id,
                              status as "completed" | "stopped",
                              date,
                              () => crypto.randomUUID(),
                            ),
                            `Initiative ${status}: ${draft.name}`,
                          ).catch((e) => setError(e.message));
                      }}
                    >
                      {status === "completed" ? <Check /> : <Pause />}
                      {status === "completed" ? "Complete" : "Stop"}
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  className="pr-button pr-primary"
                  disabled={
                    dirty || !changes.length || !!issues.length || pending
                  }
                  onClick={() => {
                    setApproveIds(
                      draft.changes.filter((c) => c.enabled).map((c) => c.id),
                    );
                    setReview(true);
                  }}
                >
                  <Check />
                  Review approval
                </button>
              )}
            </section>
            <section className="hub-impact">
              <div className="hub-section-heading">
                <h2>
                  {draft.approvedAt ? "Approved baseline" : "Connected impact"}
                </h2>
                <select
                  aria-label="Impact month"
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
              {!draft.approvedAt && (
                <div className="hub-actions hub-sandbox-controls">
                  <label className="pr-field">
                    Changes
                    <select
                      value={solo}
                      onChange={(e) => setSolo(e.target.value)}
                    >
                      <option value="">Combined proposal</option>
                      {draft.changes
                        .filter((c) => c.enabled)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} alone
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="pr-field">
                    Acquisition case
                    <select
                      value={variant}
                      onChange={(e) => setVariant(e.target.value)}
                    >
                      <option value="conservative">
                        Conservative ({draft.cases.conservative}%)
                      </option>
                      <option value="expected">
                        Expected ({draft.cases.expected}%)
                      </option>
                      <option value="optimistic">
                        Optimistic ({draft.cases.optimistic}%)
                      </option>
                    </select>
                  </label>
                  <label className="pr-field">
                    Show
                    <select
                      value={group}
                      onChange={(e) => setGroup(e.target.value)}
                    >
                      {[
                        "changed",
                        "all",
                        "Practice",
                        "Capacity",
                        "Growth",
                        "Finances",
                        "Cash",
                        "Family",
                        "Custom",
                      ].map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {!draft.approvedAt && (
                <details className="hub-details">
                  <summary>Acquisition assumptions</summary>
                  <div className="hub-form-grid">
                    {(["conservative", "optimistic"] as const).map((key) => (
                      <label className="pr-field" key={key}>
                        {key === "conservative"
                          ? "Conservative yield (%)"
                          : "Optimistic yield (%)"}
                        <input
                          type="number"
                          min={key === "conservative" ? 0 : 100}
                          max={key === "conservative" ? 100 : 200}
                          value={draft.cases[key]}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              cases: {
                                ...draft.cases,
                                [key]: Math.max(
                                  key === "conservative" ? 0 : 100,
                                  Math.min(
                                    key === "conservative" ? 100 : 200,
                                    Number(e.target.value),
                                  ),
                                ),
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </details>
              )}
              {draft.approvedAt && baseline?.after ? (
                <>
                  <ForecastChart months={baseline.after} />
                  {initiativeResults.length > 0 && (
                    <section>
                      <h3>Campaign results since launch</h3>
                      <p className="hub-muted">
                        Whole finalized periods only. Expected counts are
                        prorated acquisition-cohort estimates; recorded clients
                        are entered actuals, not proof of incremental growth.
                      </p>
                      <div className="pr-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Campaign</th>
                              <th>Approved leads</th>
                              <th>Recorded leads</th>
                              <th>Approved clients</th>
                              <th>Recorded clients</th>
                              <th>Attributed collections</th>
                            </tr>
                          </thead>
                          <tbody>
                            {initiativeResults.map((r) => (
                              <tr key={r.id}>
                                <td>{r.name}</td>
                                <td>{fmt(r.approvedLeads)}</td>
                                <td>{fmt(r.actualLeads)}</td>
                                <td>{fmt(r.approvedClients)}</td>
                                <td>{fmt(r.actualClients)}</td>
                                <td>{fmt(r.actualRevenue, "currency")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                  <details className="hub-details">
                    <summary>Recorded results vs approved expectation</summary>
                    <p className="hub-muted">
                      Whole-practice actuals for finalized periods in{" "}
                      {props.range.start} to {props.range.end}. Approved monthly
                      forecasts are prorated to those periods; attribution is
                      not proof of incremental lift.
                    </p>
                    <Warnings items={actual.warnings} />
                    <div className="pr-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Metric</th>
                            <th>Approved period estimate</th>
                            <th>Recorded actual</th>
                            <th>Variance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {metrics
                            .filter(([key]) => key in approvedActualRange)
                            .map(([key, label, unit]) => (
                              <tr key={key}>
                                <td>{label}</td>
                                <td>{fmt(approvedActualRange[key], unit)}</td>
                                <td>{fmt(actual.values[key], unit)}</td>
                                <td>
                                  {fmt(
                                    actual.values[key] == null ||
                                      approvedActualRange[key] == null
                                      ? null
                                      : actual.values[key]! -
                                          approvedActualRange[key]!,
                                    unit,
                                  )}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                  <div className="pr-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th>Approved expectation</th>
                          <th>Current plan</th>
                          <th>Variance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registeredMetrics(workspace).map(
                          ([key, label, unit]) => (
                            <tr key={key}>
                              <td>{label}</td>
                              <td>
                                {fmt(
                                  baseline.after?.find(
                                    (m) => m.date === before.date,
                                  )?.values[key],
                                  unit,
                                )}
                              </td>
                              <td>{fmt(before.values[key], unit)}</td>
                              <td>
                                {fmt(
                                  before.values[key] == null ||
                                    baseline.after?.find(
                                      (m) => m.date === before.date,
                                    )?.values[key] == null
                                    ? null
                                    : before.values[key]! -
                                        baseline.after!.find(
                                          (m) => m.date === before.date,
                                        )!.values[key]!,
                                  unit,
                                )}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <>
                  <details className="hub-details" open>
                    <summary>
                      Initiative economics / {months.length} months
                    </summary>
                    <dl className="hub-form-grid">
                      <div>
                        <dt>Incremental operating profit</dt>
                        <dd>
                          {fmt(
                            deltas.reduce((n, m) => n + m.profit, 0),
                            "currency",
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Maximum additional cash required</dt>
                        <dd>
                          {fmt(
                            Math.max(0, ...deltas.map((m) => -m.cash)),
                            "currency",
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Ending available cash change</dt>
                        <dd>{fmt(deltas.at(-1)?.cash, "currency")}</dd>
                      </div>
                      <div>
                        <dt>Cash recovery after deficit</dt>
                        <dd>
                          {firstDeficit < 0
                            ? "No cash deficit"
                            : recovered
                              ? monthLabel(recovered)
                              : "Beyond this horizon"}
                        </dd>
                      </div>
                    </dl>
                  </details>
                  <div className="pr-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Output</th>
                          <th>Active plan</th>
                          <th>Proposed</th>
                          <th>Change</th>
                          <th>Change %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changeRows.map(([key, label, unit, g]) => {
                          const a = before.values[key],
                            b = after.values[key],
                            delta = a == null || b == null ? null : b - a;
                          return (
                            <tr key={key}>
                              <td>
                                <strong>{label}</strong>
                                <small>{g}</small>
                              </td>
                              <td>{fmt(a, unit)}</td>
                              <td>{fmt(b, unit)}</td>
                              <td
                                className={
                                  delta !== null && delta !== 0
                                    ? "hub-changed"
                                    : ""
                                }
                              >
                                {fmt(delta, unit)}
                              </td>
                              <td>
                                {fmt(
                                  delta === null || a === 0
                                    ? null
                                    : (delta / Math.abs(a!)) * 100,
                                  "percent",
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {!changeRows.length && (
                    <p className="hub-muted">
                      No changed outputs in this month.
                    </p>
                  )}
                  <Warnings items={[...issues, ...after.warnings]} />
                  <ForecastChart months={proposed} />
                  <details className="hub-details">
                    <summary>Decision signals</summary>
                    <div className="pr-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Rule</th>
                            <th>Active plan trigger</th>
                            <th>Proposed trigger</th>
                            <th>Action due</th>
                          </tr>
                        </thead>
                        <tbody>
                          {signals.map((s) => (
                            <tr key={s.rule.id}>
                              <td>{s.rule.name}</td>
                              <td>
                                {currentSignals.find(
                                  (c) => c.rule.id === s.rule.id,
                                )?.date ?? "Not projected"}
                              </td>
                              <td>{s.date ?? "Not projected"}</td>
                              <td>{s.actionDate ?? "--"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                  <details className="hub-details">
                    <summary>Calculation trace</summary>
                    {Object.entries(after.trace).map(([key, value]) => (
                      <div key={key} className="hub-trace">
                        <h3>{metricMap[key]?.label ?? key}</h3>
                        <p>{value}</p>
                      </div>
                    ))}
                  </details>
                </>
              )}
            </section>
          </div>
        </>
      )}
      {error && (
        <p className="pr-error hub-error" role="alert">
          {error}
        </p>
      )}
      {editing && draft && (
        <RecordEditor
          collection="events"
          record={editing}
          workspace={{
            ...workspace,
            events: [...workspace.events, ...draft.changes],
          }}
          context={context}
          theme={theme}
          onClose={() => setEditing(null)}
          onSave={async (value) => {
            const event = value as unknown as PlanEvent;
            setDraft({
              ...draft,
              changes: draft.changes.some((c) => c.id === event.id)
                ? draft.changes.map((c) => (c.id === event.id ? event : c))
                : [...draft.changes, event],
            });
          }}
        />
      )}
      {review && draft && (
        <Dialog open onOpenChange={setReview}>
          <DialogContent
            className="practice-theme practice-dialog"
            data-appearance={theme}
          >
            <DialogHeader>
              <DialogTitle>Apply proposal to active plan?</DialogTitle>
              <DialogDescription>{draft.name}</DialogDescription>
            </DialogHeader>
            <p className="hub-muted">Approval case: Expected (100%).</p>
            <div className="hub-checks">
              {draft.changes
                .filter((c) => c.enabled)
                .map((c) => (
                  <label key={c.id}>
                    <input
                      type="checkbox"
                      checked={approveIds.includes(c.id)}
                      onChange={(e) =>
                        setApproveIds(
                          e.target.checked
                            ? [...approveIds, c.id]
                            : approveIds.filter((id) => id !== c.id),
                        )
                      }
                    />
                    {c.name} / {c.date}
                  </label>
                ))}
            </div>
            <p className="hub-muted">
              Selected changes become dated plan events. The approved forecast
              is retained. Actual records are unchanged.
            </p>
            {error && (
              <p className="pr-error" role="alert">
                {error}
              </p>
            )}
            <div className="pr-dialog-actions">
              <button className="pr-button" onClick={() => setReview(false)}>
                Cancel
              </button>
              <button
                className="pr-button pr-primary"
                disabled={pending || !approveIds.length}
                onClick={() => void apply()}
              >
                <Check />
                {pending ? "Applying..." : "Approve selected changes"}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
