import { dateSchema, daysInclusive } from "@workspace/practice";
import type { Workspace } from "@workspace/practice/hub";

export type CompletedGoal = Pick<
  Workspace["goals"][number],
  "amount" | "basis"
> & {
  metric:
    | Workspace["goals"][number]["metric"]
    | "activeClinicalHeadcount"
    | "ownerDistributionsPretax"
    | "coOwnerSalaryPretax";
};
export type FinancialGoalObservation = {
  date?: string;
  start?: string;
  end?: string;
  source?: "actual" | "forecast" | "budget";
  basis?: "period" | "monthly" | "annual";
  values: Partial<Record<CompletedGoal["metric"], number | null>>;
};
export type CompletedGoalInput = {
  goal?: CompletedGoal | null;
  workspace: Pick<Workspace, "settings" | "clinicians">;
  context: {
    clinicians: { id: number; goalId?: number | null; roleType?: string }[];
    sessions: {
      clinicianId: number;
      start: string;
      end: string;
      completed: number;
    }[];
  };
  asOf: string;
  /** Monthly forecast, used only for messaging after actual evaluation. */
  expected?: number | null;
  /** Explicit actual provenance and start/end are required; monthly reports are insufficient. */
  financialObservations?: FinancialGoalObservation[];
};
export type CompletedGoalResult = {
  status: "met" | "waiting" | "insufficient" | "no-target";
  date: string | null;
  periodStart: string | null;
  /** Actual/target are monthly equivalents, except headcount is an unscaled count. */
  value: number | null;
  target: number | null;
  forecastMet: boolean;
  message: string;
};

type Range = { start: string; end: string };
type SessionPeriod = Range & { observedWindow?: boolean };
const monthlyDays = 365.25 / 12;
const validRange = (range: Range) =>
  dateSchema.safeParse(range.start).success &&
  dateSchema.safeParse(range.end).success &&
  range.start <= range.end;
const biweekly = (range: Range) =>
  validRange(range) &&
  daysInclusive(range.start, range.end) >= 12 &&
  daysInclusive(range.start, range.end) <= 16;
const datesIn = (range: Range) =>
  Array.from({ length: daysInclusive(range.start, range.end) }, (_, index) =>
    new Date(Date.parse(range.start + "T00:00:00Z") + index * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );

function sessionPeriods(
  rows: CompletedGoalInput["context"]["sessions"],
  asOf: string,
): SessionPeriod[] {
  const candidates: SessionPeriod[] = rows
    .filter(biweekly)
    .map(({ start, end }) => ({ start, end }));
  const shortFacts = rows.filter(
    (row) =>
      validRange(row) &&
      row.end <= asOf &&
      daysInclusive(row.start, row.end) < 12,
  );
  // Each known short-fact end retains its own observed window. Older/newer
  // imports add candidates without shifting existing ones; coverage is checked below.
  for (const end of new Set(shortFacts.map((row) => row.end))) {
    const start = new Date(Date.parse(end + "T00:00:00Z") - 13 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    if (validRange({ start, end }))
      candidates.push({ start, end, observedWindow: true });
  }
  return [
    ...new Map(
      candidates.map((period) => [`${period.start}|${period.end}`, period]),
    ).values(),
  ].sort(
    (a, b) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start),
  );
}

/** Evaluate the latest fully evidenced period; forecast never establishes achievement. */
export function evaluateCompletedGoal(
  input: CompletedGoalInput,
): CompletedGoalResult {
  const { goal, workspace, context, asOf, expected } = input;
  const headcount = goal?.metric === "activeClinicalHeadcount";
  const target =
    goal && Number.isFinite(goal.amount) && goal.amount > 0
      ? goal.amount / (!headcount && goal.basis === "annual" ? 12 : 1)
      : null;
  const base = {
    date: null,
    periodStart: null,
    value: null,
    target,
    forecastMet:
      target !== null &&
      expected != null &&
      Number.isFinite(expected) &&
      expected >= target,
  };
  const result = (
    status: CompletedGoalResult["status"],
    message: string,
  ): CompletedGoalResult => ({ ...base, status, message });
  if (!goal || target === null)
    return result("no-target", "No target entered yet.");
  if (!dateSchema.safeParse(asOf).success)
    return result(
      "insufficient",
      "A valid as-of date is required to verify completed periods.",
    );

  let actual: (SessionPeriod & { value: number }) | undefined;
  if (goal.metric === "sessions" || headcount) {
    const people = context.clinicians.filter(
      (person) => (person.goalId ?? null) === workspace.settings.teamId,
    );
    const selectedIds = new Set(people.map((person) => person.id));
    const rows = context.sessions.filter((row) =>
      selectedIds.has(row.clinicianId),
    );
    const periods = sessionPeriods(rows, asOf);
    let incomplete = false;
    for (const period of periods.filter((period) => period.end <= asOf)) {
      let value = 0;
      let activeAtEnd = 0;
      let coveredPeople = 0;
      let complete = true;
      for (const person of people) {
        const settings = workspace.clinicians.filter(
          (row) => row.clinicianId === person.id,
        );
        if (headcount && !settings.length) {
          complete = false;
          break;
        }
        if (
          settings.some(
            (row) =>
              !validRange({ start: row.start, end: row.end ?? "9999-12-31" }),
          )
        ) {
          complete = false;
          break;
        }
        if (
          settings.some(
            (row) =>
              row.status === "active" &&
              row.start <= period.end &&
              (!row.end || row.end >= period.end),
          )
        )
          activeAtEnd++;
        // With no activity dates, every selected clinician is required for the entire period.
        const requiredDays = datesIn(period).filter(
          (date) =>
            !settings.length ||
            settings.some(
              (row) =>
                row.status === "active" &&
                row.start <= date &&
                (!row.end || row.end >= date),
            ),
        );
        if (!requiredDays.length) continue;
        coveredPeople++;
        const required = new Set(requiredDays);
        const coverage = new Set<string>();
        const records = rows.filter(
          (row) =>
            row.clinicianId === person.id &&
            row.start <= period.end &&
            row.end >= period.start,
        );
        for (const row of records) {
          // Never prorate an aggregate spanning outside this period or its active dates.
          if (
            !validRange(row) ||
            row.start < period.start ||
            row.end > period.end ||
            !Number.isFinite(row.completed) ||
            row.completed < 0 ||
            !Number.isInteger(row.completed)
          ) {
            complete = false;
            break;
          }
          for (const date of datesIn(row)) {
            if (!required.has(date) || coverage.has(date)) complete = false;
            coverage.add(date);
          }
          value += row.completed;
        }
        if (coverage.size !== required.size) complete = false;
      }
      if (complete && coveredPeople > 0) {
        actual = {
          ...period,
          value: headcount
            ? activeAtEnd
            : (value / daysInclusive(period.start, period.end)) * monthlyDays,
        };
        break;
      }
      incomplete = true;
    }
    if (!actual) {
      if (!people.length || !rows.length || incomplete || !periods.length)
        return result(
          "insufficient",
          headcount
            ? "Insufficient headcount data: explicit clinician active dates and a completed biweekly period with full selected-team actual coverage are required."
            : "Insufficient session data: a completed biweekly period needs full selected-team coverage on every active day.",
        );
      return result(
        "waiting",
        "Waiting for a completed biweekly session period.",
      );
    }
  } else {
    const observations = input.financialObservations ?? [];
    const actualRanges = observations.filter(
      (row): row is FinancialGoalObservation & Range =>
        row.source === "actual" &&
        row.start !== undefined &&
        row.end !== undefined &&
        validRange({ start: row.start, end: row.end }),
    );
    const dated = actualRanges.filter(biweekly);
    const completedRanges = actualRanges.filter((row) => row.end <= asOf);
    const completed = dated
      .filter((row) => row.end <= asOf)
      .sort(
        (a, b) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start),
      );
    for (const row of completed) {
      const value = row.values[goal.metric];
      if (value == null || !Number.isFinite(value)) continue;
      // Nested finalized reports can already be summed into observedSeries values.
      // Reject overlapping evidence even when the other report is not biweekly.
      if (
        completedRanges.filter(
          (other) => other.start <= row.end && other.end >= row.start,
        ).length !== 1
      )
        continue;
      actual = {
        start: row.start,
        end: row.end,
        value:
          row.basis === "monthly"
            ? value
            : row.basis === "annual"
              ? value / 12
              : (value / daysInclusive(row.start, row.end)) * monthlyDays,
      };
      break;
    }
    if (!actual) {
      if (dated.length && !completed.length)
        return result(
          "waiting",
          "Waiting for a completed biweekly financial period.",
        );
      return result(
        "insufficient",
        "Insufficient financial data: non-overlapping actual biweekly start/end dates and metric values are required. Monthly reports or allocations cannot verify achievement.",
      );
    }
  }
  const met = actual.value >= target;
  const periodLabel = actual.observedWindow
    ? "14-day observed window"
    : "period";
  return {
    ...base,
    status: met ? "met" : "waiting",
    date: actual.end,
    periodStart: actual.start,
    value: actual.value,
    message: met
      ? `Met after completed ${periodLabel} ending ${actual.end}.`
      : base.forecastMet
        ? "Projected as met; waiting for one completed biweekly period to meet the target."
        : `Actual for completed ${periodLabel} ending ${actual.end} is below the target.`,
  };
}
