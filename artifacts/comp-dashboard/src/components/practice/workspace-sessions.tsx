import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@workspace/api-client-react";
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import {
  daysInclusive,
  sessionInputSchema,
  z,
  type SessionRecord,
  type SessionWrite,
} from "@workspace/practice";
import type { Context } from "@workspace/practice/hub";
import { saveSessionRecord } from "@/lib/session-api";

type Draft = {
  completed: string;
  desired: string;
  cancelled: string;
  noShow: string;
  scheduled: string;
  inPerson: string;
  telehealth: string;
};
type Period = { start: string; end: string; records: SessionRecord[] };

const shift = (date: string, days: number) =>
  new Date(Date.parse(date + "T12:00:00Z") + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
const value = (number: number | null | undefined) =>
  number == null ? "" : String(number);
const optional = (input: string) =>
  input.trim() === "" ? null : Number(input);
const shortDate = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
const average = (values: number[]) =>
  values.length
    ? values.reduce((sum, item) => sum + item, 0) / values.length
    : null;
const display = (number: number | null, suffix = "") =>
  number == null
    ? "-"
    : number.toLocaleString("en-US", { maximumFractionDigits: 1 }) + suffix;

export default function WorkspaceSessions({
  context,
  teamId,
  sandbox,
  onSaved,
  onEditingChange,
}: {
  context: Context;
  teamId: number | null;
  sandbox: boolean;
  onSaved: () => Promise<void>;
  onEditingChange: (editing: boolean) => void;
}) {
  const people = context.clinicians.filter(
    (clinician) => (clinician.goalId ?? null) === teamId,
  );
  const personIds = new Set(people.map((person) => person.id));
  const records = context.sessions.filter((record) =>
    personIds.has(record.clinicianId),
  );
  const periods = useMemo(() => {
    const grouped = new Map<string, Period>();
    for (const record of records) {
      const key = `${record.start}|${record.end}`;
      const period = grouped.get(key) ?? {
        start: record.start,
        end: record.end,
        records: [],
      };
      period.records.push(record);
      grouped.set(key, period);
    }
    return [...grouped.values()].sort((a, b) => b.end.localeCompare(a.end));
  }, [records]);
  const today = new Date().toLocaleDateString("en-CA");
  const initial = periods[0] ?? { start: shift(today, -13), end: today };
  const [range, setRange] = useState({
    start: initial.start,
    end: initial.end,
  });
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [adjustGoals, setAdjustGoals] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [historyRange, setHistoryRange] = useState("180");
  const [customRange, setCustomRange] = useState({
    start: shift(today, -179),
    end: today,
  });
  const [columns, setColumns] = useState({
    desired: true,
    fullness: true,
    weekly: true,
    cancelled: false,
    recent: true,
  });
  const pending = useRef<Map<number, SessionWrite>>(new Map());

  const desiredFor = (personId: number) => {
    const person = people.find((item) => item.id === personId);
    return Math.round(
      ((person?.sessionsPerWeek ?? 0) * daysInclusive(range.start, range.end)) /
        7,
    );
  };
  const exactRecord = (personId: number) =>
    records.find(
      (record) =>
        record.clinicianId === personId &&
        record.start === range.start &&
        record.end === range.end,
    );
  const makeDraft = (personId: number): Draft => {
    const record = exactRecord(personId);
    return {
      completed: value(record?.completed),
      desired: String(record?.desired ?? desiredFor(personId)),
      cancelled: value(record?.cancelled),
      noShow: value(record?.noShow),
      scheduled: value(record?.scheduled),
      inPerson: value(record?.inPerson),
      telehealth: value(record?.telehealth),
    };
  };
  const resetDrafts = () => {
    setDrafts(
      Object.fromEntries(
        people.map((person) => [person.id, makeDraft(person.id)]),
      ),
    );
    setExpanded(new Set());
    setError("");
    setMessage("");
    pending.current.clear();
  };
  useEffect(resetDrafts, [
    range.start,
    range.end,
    context.sessions,
    context.clinicians,
  ]);

  const changed = (personId: number) => {
    const draft = drafts[personId];
    return (
      !!draft && JSON.stringify(draft) !== JSON.stringify(makeDraft(personId))
    );
  };
  const dirty = people.some((person) => changed(person.id));
  useEffect(() => {
    onEditingChange(dirty);
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      onEditingChange(false);
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty, onEditingChange]);

  const setDraft = (personId: number, key: keyof Draft, next: string) => {
    setDrafts((current) => ({
      ...current,
      [personId]: { ...current[personId], [key]: next },
    }));
    setError("");
    setMessage("");
  };
  const movePeriod = (direction: -1 | 1) => {
    const days = daysInclusive(range.start, range.end);
    setRange({
      start: shift(range.start, direction * days),
      end: shift(range.end, direction * days),
    });
  };
  const commandFor = (personId: number) => {
    const draft = drafts[personId];
    const record = exactRecord(personId);
    if (!draft?.completed.trim()) return null;
    const entry = sessionInputSchema.parse({
      clinicianId: personId,
      ...range,
      completed: Number(draft.completed),
      desired: Number(draft.desired),
      cancelled: optional(draft.cancelled),
      noShow: optional(draft.noShow),
      scheduled: optional(draft.scheduled),
      inPerson: optional(draft.inPerson),
      telehealth: optional(draft.telehealth),
      sourceAttachmentId: record?.sourceAttachmentId ?? null,
    });
    const existing = pending.current.get(personId);
    if (existing) {
      if (JSON.stringify(existing.entry) !== JSON.stringify(entry))
        throw new Error(
          "Retry the unconfirmed save before changing its numbers.",
        );
      return existing;
    }
    const command: SessionWrite = {
      requestId: crypto.randomUUID(),
      expectedRevision: record?.revision ?? null,
      entry,
    };
    pending.current.set(personId, command);
    return command;
  };
  async function saveAll() {
    if (busy || sandbox) return;
    try {
      const changedPeople = people.filter((person) => changed(person.id));
      const missing = changedPeople.filter(
        (person) => !drafts[person.id]?.completed.trim(),
      );
      if (missing.length)
        throw new Error(
          `Enter completed sessions for ${missing.map((person) => person.label).join(", ")}.`,
        );
      if (!changedPeople.length) return;
      setBusy(true);
      for (const person of changedPeople) {
        const command = commandFor(person.id);
        if (command) await saveSessionRecord(command);
      }
      pending.current.clear();
      await onSaved();
      setMessage(
        `Saved ${changedPeople.length} clinician${changedPeople.length === 1 ? "" : "s"}.`,
      );
    } catch (cause) {
      if (cause instanceof ApiError && [400, 404, 409].includes(cause.status)) {
        pending.current.clear();
        await onSaved();
      }
      setError(
        cause instanceof z.ZodError
          ? cause.issues.map((issue) => issue.message).join(" ")
          : cause instanceof ApiError
            ? ((cause.data as { error?: string })?.error ?? cause.message)
            : cause instanceof Error
              ? cause.message
              : "Save not confirmed. Retry the team totals.",
      );
    } finally {
      setBusy(false);
    }
  }

  const filteredPeriods = periods.filter((period) => {
    if (historyRange === "all") return true;
    const bounds =
      historyRange === "custom"
        ? customRange
        : { start: shift(today, 1 - Number(historyRange)), end: today };
    return period.end >= bounds.start && period.start <= bounds.end;
  });
  const recordFor = (period: Period, personId: number) =>
    period.records.find((record) => record.clinicianId === personId);
  const statsFor = (personId: number) => {
    const entries = filteredPeriods
      .map((period) => recordFor(period, personId))
      .filter((record): record is SessionRecord => !!record);
    const recent = entries.filter((record) => record.end >= shift(today, -60));
    const fullness = (items: SessionRecord[]) => {
      const desired = items.reduce((sum, record) => sum + record.desired, 0);
      return desired
        ? (items.reduce((sum, record) => sum + record.completed, 0) / desired) *
            100
        : null;
    };
    const recordedDays = entries.reduce(
      (sum, record) => sum + daysInclusive(record.start, record.end),
      0,
    );
    return {
      average: average(entries.map((record) => record.completed)),
      desired: average(entries.map((record) => record.desired)),
      weekly: recordedDays
        ? (entries.reduce((sum, record) => sum + record.completed, 0) /
            recordedDays) *
          7
        : null,
      fullness: fullness(entries),
      recent: average(recent.map((record) => record.completed)),
      recentFullness: fullness(recent),
    };
  };

  return (
    <section aria-label="Session totals" className="pw-session-tracker">
      <div className="pw-section-heading">
        <div>
          <h2>Sessions</h2>
          <p>Enter the whole team's biweekly totals in one pass</p>
        </div>
        <details className="pw-menu">
          <summary>
            <SlidersHorizontal /> Display
          </summary>
          <div>
            {(
              [
                ["desired", "Desired totals"],
                ["fullness", "Fullness"],
                ["weekly", "Weekly average"],
                ["cancelled", "Cancelled"],
                ["recent", "Last 2 months"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={columns[key]}
                  onChange={(event) =>
                    setColumns({ ...columns, [key]: event.target.checked })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </details>
      </div>

      {!sandbox && (
        <div className="pw-session-entry">
          <div className="pw-session-toolbar">
            <button
              className="pw-icon"
              aria-label="Previous two weeks"
              title="Previous two weeks"
              disabled={dirty || busy}
              onClick={() => movePeriod(-1)}
            >
              <ChevronLeft />
            </button>
            <div className="pw-session-dates">
              <label>
                Period starts
                <input
                  type="date"
                  value={range.start}
                  disabled={dirty || busy}
                  onChange={(event) =>
                    setRange({ ...range, start: event.target.value })
                  }
                />
              </label>
              <span>to</span>
              <label>
                Period ends
                <input
                  type="date"
                  value={range.end}
                  disabled={dirty || busy}
                  onChange={(event) =>
                    setRange({ ...range, end: event.target.value })
                  }
                />
              </label>
            </div>
            <button
              className="pw-icon"
              aria-label="Next two weeks"
              title="Next two weeks"
              disabled={dirty || busy}
              onClick={() => movePeriod(1)}
            >
              <ChevronRight />
            </button>
            <label className="pw-session-goal-toggle">
              <input
                type="checkbox"
                checked={adjustGoals}
                onChange={(event) => setAdjustGoals(event.target.checked)}
              />
              Adjust period goals
            </label>
          </div>

          <div className="pw-session-entry-grid">
            {people.map((person, index) => {
              const draft = drafts[person.id] ?? makeDraft(person.id);
              const desired = Number(draft.desired) || 0;
              const fullness =
                draft.completed.trim() && desired
                  ? (Number(draft.completed) / desired) * 100
                  : null;
              return (
                <article className="pw-session-person" key={person.id}>
                  <header>
                    <span
                      className={`pw-session-avatar pw-avatar-${index % 3}`}
                    >
                      {person.label.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <strong>{person.label}</strong>
                      <em>{desired} desired this period</em>
                    </div>
                  </header>
                  <label className="pw-session-total">
                    <span>Completed</span>
                    <input
                      aria-label={`${person.label} completed sessions`}
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={draft.completed}
                      disabled={busy}
                      placeholder="0"
                      onChange={(event) =>
                        setDraft(person.id, "completed", event.target.value)
                      }
                    />
                  </label>
                  {adjustGoals && (
                    <label className="pw-session-goal-input">
                      Desired
                      <input
                        aria-label={`${person.label} desired sessions`}
                        type="number"
                        min="0"
                        step="1"
                        value={draft.desired}
                        disabled={busy}
                        onChange={(event) =>
                          setDraft(person.id, "desired", event.target.value)
                        }
                      />
                    </label>
                  )}
                  <div className="pw-session-person-status">
                    <span>
                      {fullness == null
                        ? "Waiting for total"
                        : `${display(fullness, "%")} full`}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          next.has(person.id)
                            ? next.delete(person.id)
                            : next.add(person.id);
                          return next;
                        })
                      }
                    >
                      {expanded.has(person.id) ? "Hide details" : "Add details"}
                    </button>
                  </div>
                  {expanded.has(person.id) && (
                    <div className="pw-session-extra">
                      {(
                        [
                          ["scheduled", "Scheduled"],
                          ["cancelled", "Cancelled"],
                          ["noShow", "No-show"],
                          ["inPerson", "In person"],
                          ["telehealth", "Telehealth"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            aria-label={`${person.label} ${label}`}
                            type="number"
                            min="0"
                            step="1"
                            value={draft[key]}
                            disabled={busy}
                            onChange={(event) =>
                              setDraft(person.id, key, event.target.value)
                            }
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <div className="pw-session-savebar">
            <div>
              <strong>
                {dirty
                  ? `${people.filter((person) => changed(person.id)).length} changed`
                  : "Ready for the next update"}
              </strong>
              <span>
                {shortDate(range.start)} - {shortDate(range.end)}
              </span>
            </div>
            {dirty && (
              <button
                className="pw-button"
                type="button"
                disabled={busy || !!pending.current.size}
                onClick={resetDrafts}
              >
                <RotateCcw /> Discard
              </button>
            )}
            <button
              className="pw-button pw-primary"
              type="button"
              disabled={!dirty || busy}
              onClick={() => void saveAll()}
            >
              <Save /> {busy ? "Saving..." : "Save team totals"}
            </button>
          </div>
        </div>
      )}

      {sandbox && (
        <p className="pw-notice">
          Recorded sessions remain unchanged in Sandbox. Change desired sessions
          from Clinicians &amp; Pay.
        </p>
      )}
      {error && (
        <p className="pw-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="pw-success" role="status">
          {message}
        </p>
      )}

      <div className="pw-session-history-heading">
        <div>
          <h3>Biweekly history</h3>
          <p>Click a period to reopen it above</p>
        </div>
        <div className="pw-actions">
          <select
            aria-label="Session history range"
            value={historyRange}
            onChange={(event) => setHistoryRange(event.target.value)}
          >
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
            <option value="180">Last 6 months</option>
            <option value="all">All history</option>
            <option value="custom">Custom dates</option>
          </select>
          {historyRange === "custom" && (
            <>
              <input
                aria-label="History start"
                type="date"
                value={customRange.start}
                onChange={(event) =>
                  setCustomRange({ ...customRange, start: event.target.value })
                }
              />
              <input
                aria-label="History end"
                type="date"
                value={customRange.end}
                onChange={(event) =>
                  setCustomRange({ ...customRange, end: event.target.value })
                }
              />
            </>
          )}
        </div>
      </div>
      <div className="pw-session-matrix-wrap">
        <table className="pw-session-matrix">
          <thead>
            <tr>
              <th>Period</th>
              {people.map((person) => (
                <th key={person.id}>{person.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredPeriods.map((period) => (
              <tr key={`${period.start}-${period.end}`}>
                <th>
                  <button
                    disabled={dirty || sandbox}
                    onClick={() =>
                      setRange({ start: period.start, end: period.end })
                    }
                  >
                    <strong>{shortDate(period.start)}</strong>
                    <span>to {shortDate(period.end)}</span>
                  </button>
                </th>
                {people.map((person) => {
                  const record = recordFor(period, person.id);
                  const fullness = record?.desired
                    ? (record.completed / record.desired) * 100
                    : null;
                  return (
                    <td key={person.id}>
                      {record ? (
                        <div className="pw-session-history-value">
                          <strong>{record.completed}</strong>
                          {columns.desired && <span>of {record.desired}</span>}
                          {columns.fullness && fullness != null && (
                            <em
                              data-tone={
                                fullness >= 80
                                  ? "good"
                                  : fullness >= 60
                                    ? "watch"
                                    : "low"
                              }
                            >
                              {display(fullness, "%")}
                            </em>
                          )}
                          {columns.cancelled && record.cancelled != null && (
                            <small>{record.cancelled} cancelled</small>
                          )}
                        </div>
                      ) : (
                        <span className="pw-session-missing">-</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {!filteredPeriods.length && (
            <tbody>
              <tr>
                <td colSpan={people.length + 1} className="pw-empty">
                  No session totals in this date range.
                </td>
              </tr>
            </tbody>
          )}
          {!!filteredPeriods.length && (
            <tfoot>
              <tr>
                <th>Average / period</th>
                {people.map((person) => (
                  <td key={person.id}>
                    {display(statsFor(person.id).average)}
                  </td>
                ))}
              </tr>
              {columns.desired && (
                <tr>
                  <th>Average desired</th>
                  {people.map((person) => (
                    <td key={person.id}>
                      {display(statsFor(person.id).desired)}
                    </td>
                  ))}
                </tr>
              )}
              {columns.fullness && (
                <tr>
                  <th>Overall fullness</th>
                  {people.map((person) => (
                    <td key={person.id}>
                      {display(statsFor(person.id).fullness, "%")}
                    </td>
                  ))}
                </tr>
              )}
              {columns.weekly && (
                <tr>
                  <th>Average weekly</th>
                  {people.map((person) => (
                    <td key={person.id}>
                      {display(statsFor(person.id).weekly)}
                    </td>
                  ))}
                </tr>
              )}
              {columns.recent && (
                <tr>
                  <th>Last 2 months</th>
                  {people.map((person) => (
                    <td key={person.id}>
                      {display(statsFor(person.id).recent)}
                    </td>
                  ))}
                </tr>
              )}
              {columns.recent && columns.fullness && (
                <tr>
                  <th>Last 2 months fullness</th>
                  {people.map((person) => (
                    <td key={person.id}>
                      {display(statsFor(person.id).recentFullness, "%")}
                    </td>
                  ))}
                </tr>
              )}
            </tfoot>
          )}
        </table>
      </div>
      {!people.length && (
        <p className="pw-empty">Add a clinician to this practice first.</p>
      )}
      {!sandbox && (
        <a
          className="pw-subtle-link"
          href="/practice"
          target="_blank"
          rel="noreferrer"
        >
          Open detailed session reporting
        </a>
      )}
    </section>
  );
}
