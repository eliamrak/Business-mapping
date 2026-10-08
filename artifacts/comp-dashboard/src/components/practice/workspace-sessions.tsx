import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Flag,
  PencilLine,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import {
  dateRangeSchema,
  daysInclusive,
  sessionInputSchema,
  z,
  type SessionRecord,
  type SessionWrite,
} from "@workspace/practice";
import type { Context, ForecastMonth } from "@workspace/practice/hub";
import {
  listSessionGoals,
  saveSessionGoal,
  saveSessionRecord,
  sessionGoalKey,
} from "@/lib/session-api";
import {
  annualGoalFor,
  desiredSessionsForPeriod,
  desiredSessionsForRecordYear,
  sessionGoalYear,
  weeklyGoalFromPeriodDesired,
} from "@/lib/session-goals";
import { firstHiringReviewMonth, summarizeHiringReadiness, summarizeLast1099Period, summarizeSessionOverview } from "@/lib/session-overview";
import SessionImportDialog from "./session-import-dialog";
import BulkSessionEntry from "./bulk-session-entry";

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
const forecastMonthLabel = (date: string) =>
  new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
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
  onPlanHire,
  onOpenCalculations,
  forecastMonths,
}: {
  context: Context;
  teamId: number | null;
  sandbox: boolean;
  onSaved: () => Promise<void>;
  onEditingChange: (editing: boolean) => void;
  onPlanHire: () => void;
  onOpenCalculations: () => void;
  forecastMonths: ForecastMonth[];
}) {
  const queryClient = useQueryClient();
  const team = teamId === null ? "unassigned" : String(teamId);
  const sessionGoals = useQuery({
    queryKey: sessionGoalKey(team),
    queryFn: ({ signal }) => listSessionGoals(team, signal),
    enabled: !sandbox,
  });
  const annualGoals = sessionGoals.data ?? [];
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
  const [importOpen, setImportOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<"single" | "bulk">(
    records.length ? "single" : "bulk",
  );
  const [entryOpen, setEntryOpen] = useState(!records.length);
  const entryRef = useRef<HTMLDivElement>(null);
  const [bulkState, setBulkState] = useState({ dirty: false, busy: false });
  const [historyRange, setHistoryRange] = useState("4periods");
  const [hireThreshold, setHireThreshold] = useState(80);
  const [excludedFromHire, setExcludedFromHire] = useState<Set<number>>(new Set());
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

  const desiredFor = (personId: number, period = range) => {
    const person = people.find((item) => item.id === personId);
    const sessionsPerWeek = annualGoalFor(
      personId,
      sessionGoalYear(period),
      annualGoals,
    ) ?? person?.sessionsPerWeek ?? 0;
    return desiredSessionsForPeriod(sessionsPerWeek, period);
  };
  const comparisonDesiredFor = (record: SessionRecord) =>
    desiredSessionsForRecordYear(
      record,
      people.find((person) => person.id === record.clinicianId),
      annualGoals,
    );
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
      desired: String(record ? comparisonDesiredFor(record) : desiredFor(personId)),
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
    sessionGoals.data,
  ]);

  const changed = (personId: number) => {
    const draft = drafts[personId];
    return (
      !!draft && JSON.stringify(draft) !== JSON.stringify(makeDraft(personId))
    );
  };
  const dirty = people.some((person) => changed(person.id));
  useEffect(() => {
    onEditingChange(dirty || bulkState.dirty || bulkState.busy || importOpen);
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || bulkState.dirty || bulkState.busy || importOpen) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      onEditingChange(false);
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty, bulkState.dirty, bulkState.busy, importOpen, onEditingChange]);

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
        const draft = drafts[person.id];
        if (draft && Number(draft.desired) !== desiredFor(person.id)) {
          await saveSessionGoal({
            clinicianId: person.id,
            year: sessionGoalYear(range),
            sessionsPerWeek: weeklyGoalFromPeriodDesired(Number(draft.desired), range),
          });
        }
        const command = commandFor(person.id);
        if (command) await saveSessionRecord(command);
      }
      pending.current.clear();
      await queryClient.invalidateQueries({ queryKey: sessionGoalKey(team) });
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

  const completedPeriods = periods.filter((period) => period.end <= today);
  const currentFour = completedPeriods.slice(0, 4);
  const previousFour = completedPeriods.slice(4, 8);
  const hiring = summarizeHiringReadiness(
    people.filter((person) => !excludedFromHire.has(person.id)).map((person) => ({
      id: person.id,
      goalWeekly: person.sessionsPerWeek,
      records: currentFour.flatMap((period) =>
        period.records.filter((record) => record.clinicianId === person.id),
      ),
    })),
    hireThreshold,
    4,
    !!currentFour[0] && daysInclusive(currentFour[0].end, today) > 28,
  );
  const projectedReview = firstHiringReviewMonth(
    forecastMonths,
    hiring.assessed.map((person) => person.id),
    hireThreshold,
  );
  const projectedMonthsAway = projectedReview
    ? (Number(projectedReview.slice(0, 4)) - Number(today.slice(0, 4))) * 12 +
      Number(projectedReview.slice(5, 7)) - Number(today.slice(5, 7))
    : null;
  const bounds = historyRange === "custom"
    ? customRange
    : historyRange === "all" || historyRange === "4periods"
      ? null
      : { start: shift(today, 1 - Number(historyRange)), end: today };
  const boundsValid = !bounds || dateRangeSchema.safeParse(bounds).success;
  const filteredPeriods = historyRange === "4periods"
    ? currentFour
    : periods.filter((period) =>
      boundsValid && (!bounds || (period.end >= bounds.start && period.start <= bounds.end)),
    );
  const previousBounds = bounds && boundsValid
    ? {
        start: shift(bounds.start, -daysInclusive(bounds.start, bounds.end)),
        end: shift(bounds.start, -1),
      }
    : null;
  const previousOverviewRecords = historyRange === "4periods"
    ? previousFour.flatMap((period) => period.records)
    : previousBounds
      ? records.filter((record) => record.end >= previousBounds.start && record.end <= previousBounds.end)
      : [];
  const recordFor = (period: Period, personId: number) =>
    period.records.find((record) => record.clinicianId === personId);
  const overviewFor = (personId: number) => {
    const current = (historyRange === "4periods"
      ? currentFour.flatMap((period) => period.records)
      : bounds
        ? boundsValid
          ? records.filter((record) => record.end >= bounds.start && record.end <= bounds.end)
          : []
        : records
    ).filter((record) => record.clinicianId === personId);
    const previous = previousOverviewRecords.filter((record) => record.clinicianId === personId);
    const summary = summarizeSessionOverview(
      current, previous,
      people.find((person) => person.id === personId)?.sessionsPerWeek ?? 0,
    );
    return {
      ...summary,
      trendWeekly: historyRange === "4periods" && (current.length < 4 || previous.length < 4)
        ? null
        : summary.trendWeekly,
    };
  };
  const statsFor = (personId: number) => {
    const entries = filteredPeriods
      .map((period) => recordFor(period, personId))
      .filter((record): record is SessionRecord => !!record);
    const recent = entries.filter((record) => record.end >= shift(today, -60));
    const fullness = (items: SessionRecord[]) => {
      const desired = items.reduce(
        (sum, record) => sum + comparisonDesiredFor(record),
        0,
      );
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
      desired: average(entries.map(comparisonDesiredFor)),
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
          <p>Biweekly session pace</p>
        </div>
        <div className="pw-actions">
          {!sandbox && (
            <button
              className="pw-button"
              disabled={dirty || busy || bulkState.dirty || bulkState.busy}
              onClick={() => setImportOpen(true)}
            >
              <Upload /> Upload file
            </button>
          )}
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
      </div>

      <div className="pw-session-overview-heading">
        <div>
          <h3>Team pace</h3>
          <p>{filteredPeriods.length} recorded period{filteredPeriods.length === 1 ? "" : "s"} in view</p>
        </div>
        <div className="pw-session-range">
          <select
            aria-label="Session date range"
            value={historyRange}
            onChange={(event) => setHistoryRange(event.target.value)}
          >
            <option value="4periods">Last 4 periods</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
            <option value="180">Last 6 months</option>
            <option value="all">All history</option>
            <option value="custom">Custom dates</option>
          </select>
          {historyRange === "custom" && (
            <>
              <input aria-label="Range starts" type="date" value={customRange.start}
                onChange={(event) => setCustomRange({ ...customRange, start: event.target.value })} />
              <input aria-label="Range ends" type="date" value={customRange.end}
                onChange={(event) => setCustomRange({ ...customRange, end: event.target.value })} />
            </>
          )}
        </div>
      </div>
      {!!people.length && (
        <div className="pw-session-overview" aria-label="Clinician session pace">
          {people.map((person, index) => {
            const { latest, averageWeekly, goalWeekly, openWeekly, overGoalWeekly, fullness, trendWeekly, count } = overviewFor(person.id);
            const last1099 = summarizeLast1099Period(
              records.filter((record) => record.clinicianId === person.id),
              today,
            );
            const trend = trendWeekly == null ? "empty" : trendWeekly > 0 ? "up" : trendWeekly < 0 ? "down" : "flat";
            return (
              <div className="pw-session-overview-row" key={person.id}>
                <div className="pw-session-overview-name">
                  <span className={`pw-session-avatar pw-avatar-${index % 3}`}>{person.label.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{person.label}</strong><small>{count} recorded period{count === 1 ? "" : "s"}{latest ? `, through ${shortDate(latest.end)}` : ""}</small></div>
                </div>
                <div className="pw-session-overview-stat pw-session-overview-capacity">
                  <span>Sessions / week</span>
                  <div className="pw-session-capacity-values">
                    <div className="pw-session-biweekly">
                      <strong>{last1099 ? display(last1099.completed) : "-"}</strong>
                      <small>{last1099?.recorded === false ? "Last two weeks; not recorded" : "Last two weeks"}</small>
                    </div>
                    <div><strong>{display(averageWeekly)}</strong><small>avg completed</small></div>
                    <div><strong>{display(openWeekly)}</strong><small>to desired pace</small></div>
                  </div>
                  <div className="pw-session-fill-track" aria-hidden="true">
                    <span style={{ width: `${Math.min(Math.max(fullness ?? 0, 0), 100)}%` }} />
                  </div>
                  <small>{goalWeekly > 0
                    ? `Goal ${display(goalWeekly)} / week, ${display(fullness, "%")} filled${overGoalWeekly ? `, ${display(overGoalWeekly)} over goal` : ""}`
                    : "No weekly goal set"}</small>
                </div>
                <div className="pw-session-overview-stat pw-session-overview-trend" data-trend={trend}>
                  <span>Trend</span>
                  <strong>{trendWeekly == null ? "-" : <>
                    {trend === "up" ? <ArrowUpRight aria-hidden="true" />
                      : trend === "down" ? <ArrowDownRight aria-hidden="true" />
                        : <ArrowRight aria-hidden="true" />}
                    {trendWeekly > 0 ? "+" : ""}{display(trendWeekly)}
                  </>}</strong>
                  <small>{trendWeekly == null
                    ? "Not enough earlier data"
                    : historyRange === "4periods" ? "vs previous 4 periods"
                      : historyRange === "custom" ? "vs previous date range"
                        : `vs previous ${historyRange} days`}</small>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!sandbox && (
        <section className="pw-hiring-pulse" aria-label="Hiring outlook">
          <div className="pw-hiring-pulse-main">
            <div>
              <h3>Hiring outlook</h3>
              <strong className="pw-hiring-pulse-result">
                {hiring.status === "review_hire"
                  ? "At review point now"
                  : hiring.selectedCount === 0
                    ? "No team selected"
                    : projectedReview
                      ? `Review around ${forecastMonthLabel(projectedReview)} (${projectedMonthsAway} months away)`
                      : forecastMonths.length
                        ? `Not within ${forecastMonths.length} forecast months`
                        : "No forecast available"}
              </strong>
              <p>
                {hiring.status === "no_selection"
                  ? "Select clinicians with a desired weekly pace."
                  : hiring.status === "needs_data"
                    ? `${hiring.missing.length} of ${hiring.selectedCount} selected clinicians need 4 consecutive biweekly periods.`
                    : hiring.status === "stale"
                      ? `Last recorded period ended ${shortDate(currentFour[0]?.end ?? today)}. Update sessions before relying on this signal.`
                    : hiring.status === "below_threshold"
                      ? `${hiring.below.length} of ${hiring.selectedCount} selected clinicians are below ${hireThreshold}% of desired sessions; ${display(hiring.weeklyGap)} more sessions / week to reach it.`
                      : `All ${hiring.selectedCount} selected clinicians are at or above ${hireThreshold}% of desired sessions. Review whether to hire.`}
              </p>
            </div>
            <div className="pw-hiring-pulse-actions">
              <button className="pw-button" type="button" onClick={onOpenCalculations}
                disabled={dirty || busy || bulkState.dirty || bulkState.busy || importOpen}
                title={dirty || bulkState.dirty ? "Save session edits before opening Calculations" : undefined}>
                <SlidersHorizontal /> Calculations
              </button>
              <button className="pw-button" type="button" onClick={onPlanHire}
                disabled={dirty || busy || bulkState.dirty || bulkState.busy || importOpen}
                title={dirty || bulkState.dirty ? "Save session edits before opening Planning" : undefined}>
                <Flag /> Try a hire in Planning
              </button>
            </div>
          </div>
          <details className="pw-hiring-pulse-settings">
            <summary>Who counts toward this signal</summary>
            <div className="pw-hiring-pulse-controls">
              <label>Review at
                <input aria-label="Hiring fullness threshold" type="number" min="1" max="100"
                  value={hireThreshold}
                  onChange={(event) => setHireThreshold(Math.min(100, Math.max(1, Number(event.target.value) || 1)))} />
                % of desired sessions
              </label>
              <div className="pw-hiring-pulse-people">
                {people.filter((person) => person.sessionsPerWeek > 0).map((person) => {
                  const assessment = hiring.assessed.find((item) => item.id === person.id);
                  const personalReview = firstHiringReviewMonth(forecastMonths, [person.id], hireThreshold);
                  return <label key={person.id}>
                    <input type="checkbox" checked={!excludedFromHire.has(person.id)}
                      onChange={(event) => setExcludedFromHire((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.delete(person.id);
                        else next.add(person.id);
                        return next;
                      })} />
                    {person.label}
                    {assessment && <small>{assessment.recordedPeriods}/4 periods{assessment.consecutive ? "" : "; check dates"}; {display(assessment.averageWeekly)} / {display(person.sessionsPerWeek)} weekly{personalReview
                      ? `; projected ${forecastMonthLabel(personalReview)}` : ""}</small>}
                  </label>;
                })}
              </div>
            </div>
          </details>
        </section>
      )}

      {!sandbox && (
        <div className="pw-session-entry-control">
          <button className="pw-button" type="button" aria-expanded={entryOpen}
            disabled={entryOpen && (dirty || busy || bulkState.dirty || bulkState.busy)}
            onClick={() => setEntryOpen(!entryOpen)}>
            <PencilLine /> {entryOpen ? "Close entry" : "Enter or edit totals"}
          </button>
        </div>
      )}

      {!sandbox && entryOpen && <div ref={entryRef}>
        <div className="pw-segmented pw-session-entry-modes" role="tablist" aria-label="Session entry">
          <button role="tab" aria-selected={entryMode === "single"}
            disabled={bulkState.dirty || bulkState.busy}
            onClick={() => setEntryMode("single")}>One period</button>
          <button role="tab" aria-selected={entryMode === "bulk"}
            disabled={dirty || busy}
            onClick={() => setEntryMode("bulk")}>Bulk entry</button>
        </div>

      {entryMode === "single" && (
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
              Adjust yearly goals
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
                      Desired this period
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

      {entryMode === "bulk" && (
        <BulkSessionEntry
          people={people}
          records={records}
          initialRange={range}
          onSaved={onSaved}
          onStateChange={setBulkState}
          goals={annualGoals}
        />
      )}
      </div>}

      {sandbox && (
        <p className="pw-notice">
          Recorded sessions stay separate from this model. Change desired sessions
          in Clinicians &amp; Pay, or import a Sessions section.
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
          <p>Select a period to edit its totals</p>
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
                    disabled={dirty || bulkState.dirty || bulkState.busy || sandbox}
                    onClick={() => {
                      setRange({ start: period.start, end: period.end });
                      setEntryMode("single");
                      setEntryOpen(true);
                      requestAnimationFrame(() => entryRef.current?.scrollIntoView({ block: "start" }));
                    }}
                  >
                    <strong>{shortDate(period.start)}</strong>
                    <span>to {shortDate(period.end)}</span>
                  </button>
                </th>
                {people.map((person) => {
                  const record = recordFor(period, person.id);
                  const desired = record ? comparisonDesiredFor(record) : 0;
                  const fullness = desired
                    ? (record!.completed / desired) * 100
                    : null;
                  return (
                    <td key={person.id}>
                      {record ? (
                        <div className="pw-session-history-value">
                          <strong>{record.completed}</strong>
                          {columns.desired && <span>of {desired}</span>}
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
      {importOpen && (
        <SessionImportDialog
          context={context}
          teamId={teamId}
          goals={annualGoals}
          onSaved={onSaved}
          onClose={(note) => {
            setImportOpen(false);
            if (note) setMessage(note);
          }}
        />
      )}
    </section>
  );
}
