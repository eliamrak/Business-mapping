import { useEffect, useRef, useState } from "react";
import { Play, Save, Plus, Square, FlaskConical, Trash2 } from "lucide-react";
import {
  goalSearchSchema,
  monthDate,
  monthEnd,
  proposalSchema,
  metricMap,
  type GoalSearch,
  type GoalSearchResult,
} from "@workspace/practice/hub";
import { fmt, monthLabel, ForecastTable, type ViewProps } from "./views";
import { useUnsaved } from "./use-unsaved";

export default function GoalSearchView(props: ViewProps) {
  const { workspace: w, context } = props;
  const initial =
    w.settings.goalSearch ??
    goalSearchSchema.parse({
      metric: "revenue",
      target: 50000,
      firstStart: w.settings.forecastStart,
      lastStart: w.settings.forecastStart,
      deadline: monthEnd(
        monthDate(w.settings.forecastStart, w.settings.horizonMonths - 1),
      ),
      minimumCash: w.settings.minimumCash,
    });
  const [draft, setDraft] = useState<GoalSearch>(initial),
    [saved, setSaved] = useState(JSON.stringify(initial));
  const [result, setResult] = useState<GoalSearchResult | null>(null),
    [fingerprint, setFingerprint] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [selected, setSelected] = useState(0);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const currentFingerprint = JSON.stringify({ w, context, draft });
  const stale = !!result && fingerprint !== currentFingerprint;
  useUnsaved(JSON.stringify(draft) !== saved);
  const update = (patch: Partial<GoalSearch>) =>
    setDraft({ ...draft, ...patch });
  const numeric = (
    key: keyof GoalSearch,
    label: string,
    min = 0,
    max?: number,
  ) => (
    <label className="pr-field" key={key}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={Number(draft[key])}
        onChange={(e) => update({ [key]: Number(e.target.value) })}
      />
    </label>
  );
  const run = () => {
    setError("");
    setMessage("");
    setResult(null);
    const parsed = goalSearchSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" "));
      return;
    }
    worker.current?.terminate();
    const task = new Worker(
      new URL("./goal-search.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = task;
    setPending(true);
    setFingerprint(currentFingerprint);
    task.onmessage = (e) => {
      setPending(false);
      if (e.data.error) setError(e.data.error);
      else {
        setResult(e.data.result);
        setSelected(0);
      }
      task.terminate();
      worker.current = null;
    };
    task.onerror = () => {
      setError("Search could not finish. Narrow the ranges and retry.");
      setPending(false);
      task.terminate();
      worker.current = null;
    };
    task.postMessage({ workspace: w, context, search: parsed.data });
  };
  const candidates = result?.best.length
    ? result.best
    : result?.nearest
      ? [result.nearest]
      : [];
  const candidate = candidates[selected] ?? candidates[0];
  return (
    <section className="hub-solver">
      <h2>Find a workable path</h2>
      <div className="hub-form-grid">
        <label className="pr-field">
          Monthly goal
          <select
            value={draft.metric}
            onChange={(e) =>
              update({ metric: e.target.value as GoalSearch["metric"] })
            }
          >
            {["sessions", "revenue", "profit", "familyTakeHome"].map((key) => (
              <option key={key} value={key}>
                {metricMap[key].label}
              </option>
            ))}
          </select>
        </label>
        {numeric("target", "Monthly target")}
        <label className="pr-field">
          Goal month
          <select
            value={draft.deadline.slice(0, 7)}
            onChange={(e) =>
              update({ deadline: monthEnd(e.target.value + "-01") })
            }
          >
            {props.months.map((m) => (
              <option key={m.date} value={m.date.slice(0, 7)}>
                {monthLabel(m.date)}
              </option>
            ))}
          </select>
        </label>
        {["firstStart", "lastStart"].map((key) => (
          <label className="pr-field" key={key}>
            {key === "firstStart" ? "First launch month" : "Last launch month"}
            <select
              value={draft[key as "firstStart" | "lastStart"].slice(0, 7)}
              onChange={(e) => update({ [key]: e.target.value + "-01" })}
            >
              {props.months.map((m) => (
                <option key={m.date} value={m.date.slice(0, 7)}>
                  {monthLabel(m.date)}
                </option>
              ))}
            </select>
          </label>
        ))}
        {numeric("sustainMonths", "Consecutive months meeting goal", 1, 12)}
        {numeric("minimumCash", "Minimum cash balance ($)", -1e10)}
        <label className="pr-field">
          Rank results by
          <select
            value={draft.objective}
            onChange={(e) =>
              update({ objective: e.target.value as GoalSearch["objective"] })
            }
          >
            <option value="earliest">Earliest goal date</option>
            <option value="fewest_hires">Fewest new clinicians</option>
            <option value="lowest_cost">Lowest monthly operating cost</option>
          </select>
        </label>
      </div>
      <details className="hub-details" open>
        <summary>Clinician mix</summary>
        {draft.hiring.map((choice, i) => (
          <div className="hub-form-grid" key={i}>
            <label className="pr-field">
              Hiring profile
              <select
                value={choice.profileId}
                onChange={(e) =>
                  update({
                    hiring: draft.hiring.map((x, j) =>
                      i === j ? { ...x, profileId: e.target.value } : x,
                    ),
                  })
                }
              >
                {w.hiring
                  .filter((h) => !h.archived)
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="pr-field">
              Maximum hires
              <input
                type="number"
                min="0"
                max="10"
                value={choice.maxCount}
                onChange={(e) =>
                  update({
                    hiring: draft.hiring.map((x, j) =>
                      i === j ? { ...x, maxCount: Number(e.target.value) } : x,
                    ),
                  })
                }
              />
            </label>
            <button
              className="pr-icon"
              aria-label="Remove hiring option"
              title="Remove hiring option"
              onClick={() =>
                update({ hiring: draft.hiring.filter((_, j) => i !== j) })
              }
            >
              <Trash2 />
            </button>
          </div>
        ))}
        <button
          className="pr-button"
          disabled={
            draft.hiring.length >= 3 ||
            !w.hiring.some(
              (h) =>
                !h.archived && !draft.hiring.some((x) => x.profileId === h.id),
            )
          }
          onClick={() =>
            update({
              hiring: [
                ...draft.hiring,
                {
                  profileId: w.hiring.find(
                    (h) =>
                      !h.archived &&
                      !draft.hiring.some((x) => x.profileId === h.id),
                  )!.id,
                  maxCount: 2,
                },
              ],
            })
          }
        >
          <Plus />
          Hiring profile
        </button>
      </details>
      <details className="hub-details">
        <summary>Rooms and campaign spending</summary>
        <div className="hub-form-grid">
          <label className="pr-field">
            Room template
            <select
              value={draft.roomId ?? ""}
              onChange={(e) =>
                update({
                  roomId: e.target.value || null,
                  maxRooms: e.target.value ? draft.maxRooms : 0,
                })
              }
            >
              <option value="">No extra rooms</option>
              {w.rooms
                .filter((r) => !r.archived)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          {draft.roomId && (
            <>
              {numeric("maxRooms", "Maximum additional rooms", 0, 10)}
              {numeric("roomSetupCost", "Setup cost per room ($)")}
              {numeric("roomMonthlyCost", "Monthly cost per room ($)")}
            </>
          )}
          <label className="pr-field">
            Campaign
            <select
              value={draft.campaignId ?? ""}
              onChange={(e) => update({ campaignId: e.target.value || null })}
            >
              <option value="">Keep current campaign budgets</option>
              {w.campaigns
                .filter((c) => !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          {draft.campaignId && (
            <>
              {numeric("spendMin", "Minimum monthly ad spend ($)")}
              {numeric("spendMax", "Maximum monthly ad spend ($)")}
              {numeric("spendStep", "Spend step ($)", 1)}
            </>
          )}
        </div>
      </details>
      <div className="hub-actions">
        <button
          className="pr-button"
          disabled={pending}
          onClick={() => {
            const parsed = goalSearchSchema.safeParse(draft);
            if (!parsed.success) {
              setError(parsed.error.issues.map((i) => i.message).join(" "));
              return;
            }
            void props
              .save(
                { ...w, settings: { ...w.settings, goalSearch: parsed.data } },
                "Save goal search assumptions",
              )
              .then(() => {
                setSaved(JSON.stringify(draft));
                setMessage("Search assumptions saved.");
              })
              .catch((e) => setError(e.message));
          }}
        >
          <Save />
          Save assumptions
        </button>
        <button
          className="pr-button pr-primary"
          disabled={pending}
          onClick={run}
        >
          <Play />
          {pending ? "Testing combinations..." : "Find options"}
        </button>
        {pending && (
          <button
            className="pr-button"
            onClick={() => {
              worker.current?.terminate();
              worker.current = null;
              setPending(false);
            }}
          >
            <Square />
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p className="pr-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {result && (
        <>
          <p className="hub-muted">
            {result.tested} combinations tested; {result.feasible} meet the goal
            and cash floor. Monthly estimates, not guaranteed outcomes. Results
            cover the selected ranges, not every possible business strategy.
          </p>
          {stale && (
            <p role="status">
              Inputs changed. Run the search again before creating a proposal.
            </p>
          )}
          {candidate && (
            <>
              <div className="hub-section-heading">
                <h3>
                  {candidate.feasible
                    ? "Feasible options"
                    : "Closest tested option / goal or cash constraint unmet"}
                </h3>
                <select
                  aria-label="Goal search result"
                  value={selected}
                  onChange={(e) => setSelected(Number(e.target.value))}
                >
                  {candidates.map((c, i) => (
                    <option key={i} value={i}>
                      {i + 1}: {c.hires} hires, {c.rooms} rooms,{" "}
                      {monthLabel(c.start)}
                    </option>
                  ))}
                </select>
                <button
                  className="pr-button"
                  disabled={stale || !candidate.events.length}
                  onClick={() => {
                    const proposal = proposalSchema.parse({
                      id: crypto.randomUUID(),
                      name: `${metricMap[draft.metric].label} goal / ${monthLabel(candidate.start)}`,
                      changes: candidate.events,
                    });
                    void props
                      .save(
                        { ...w, proposals: [...w.proposals, proposal] },
                        "Draft goal-search proposal",
                      )
                      .then(() =>
                        setMessage("Proposal saved in Sandbox for review."),
                      )
                      .catch((e) => setError(e.message));
                  }}
                >
                  <FlaskConical />
                  Draft proposal
                </button>
              </div>
              <div className="hub-stats">
                <div>
                  <span>Goal reached</span>
                  <strong>
                    {candidate.date
                      ? monthLabel(candidate.date)
                      : "Not reached"}
                  </strong>
                </div>
                <div>
                  <span>Monthly result</span>
                  <strong>
                    {fmt(candidate.achieved, metricMap[draft.metric].unit)}
                  </strong>
                </div>
                <div>
                  <span>Minimum cash</span>
                  <strong>{fmt(candidate.minimumCash, "currency")}</strong>
                </div>
                <div>
                  <span>Cash-floor shortfall</span>
                  <strong>{fmt(candidate.additionalCash, "currency")}</strong>
                </div>
              </div>
              <p className="hub-muted">
                Limiting factor: {candidate.constraint}. Hiring compensation,
                recruiting costs and ramp follow the selected profiles.
              </p>
              <ForecastTable
                months={candidate.months}
                keys={[
                  "sessions",
                  "revenue",
                  "profit",
                  "cash",
                  "familyTakeHome",
                ]}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
