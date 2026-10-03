import { daysInclusive, type SessionRecord } from "@workspace/practice";
import { biweeklyThursdayPayDatesThrough, payrollPeriodForPayDate } from "@workspace/practice/hub";

const weeklyPace = (records: SessionRecord[]) => {
  const recordedDays = records.reduce(
    (total, record) => total + daysInclusive(record.start, record.end), 0,
  );
  return recordedDays
    ? records.reduce((total, record) => total + record.completed, 0) * 7 / recordedDays
    : null;
};

export function summarizeSessionOverview(
  records: SessionRecord[],
  previousRecords: SessionRecord[],
  weeklyGoal: number,
) {
  const latest = records.reduce<SessionRecord | null>(
    (current, record) => !current || record.end > current.end ? record : current,
    null,
  );
  const averageWeekly = weeklyPace(records);
  const previousAverageWeekly = weeklyPace(previousRecords);
  const fullness = averageWeekly !== null && weeklyGoal > 0
    ? averageWeekly / weeklyGoal * 100
    : null;
  return {
    latest,
    averageWeekly,
    goalWeekly: weeklyGoal,
    openWeekly: averageWeekly !== null && weeklyGoal > 0
      ? Math.max(weeklyGoal - averageWeekly, 0)
      : null,
    overGoalWeekly: averageWeekly !== null && weeklyGoal > 0
      ? Math.max(averageWeekly - weeklyGoal, 0)
      : null,
    fullness,
    trendWeekly: averageWeekly !== null && previousAverageWeekly !== null
      ? Math.round((averageWeekly - previousAverageWeekly) * 10) / 10
      : null,
    count: records.length,
  };
}

export function lastCompleted1099ServicePeriod(today: string) {
  const payDate = biweeklyThursdayPayDatesThrough("2026-01-01", today, "2026-01-01").at(-1);
  if (!payDate) return null;
  return { payDate, ...payrollPeriodForPayDate("biweekly_thursday", payDate) };
}

export function summarizeLast1099Period(records: SessionRecord[], today: string) {
  const period = lastCompleted1099ServicePeriod(today);
  if (!period) return null;
  const record = records.find((item) => item.start === period.start && item.end === period.end);
  return {
    ...period,
    completed: record?.completed ?? null,
    recorded: !!record,
  };
}

export type HiringPace = {
  id: number;
  goalWeekly: number;
  records: SessionRecord[];
};

const consecutiveBiweekly = (records: SessionRecord[], required: number) => {
  const ordered = [...records].sort((a, b) => a.start.localeCompare(b.start));
  return ordered.length >= required && ordered.slice(-required).every((record, index, recent) =>
    daysInclusive(record.start, record.end) === 14 &&
    (index === 0 ||
      Date.parse(record.start + "T12:00:00Z") -
        Date.parse(recent[index - 1].end + "T12:00:00Z") === 86_400_000),
  );
};

export function summarizeHiringReadiness(
  clinicians: HiringPace[],
  thresholdPct: number,
  requiredPeriods = 4,
  stale = false,
) {
  const eligible = clinicians.filter((person) => person.goalWeekly > 0);
  const assessed = eligible.map((person) => ({
    id: person.id,
    goalWeekly: person.goalWeekly,
    recordedPeriods: person.records.length,
    consecutive: consecutiveBiweekly(person.records, requiredPeriods),
    averageWeekly: weeklyPace(person.records),
  }));
  const missing = assessed.filter((person) => !person.consecutive);
  const complete = assessed.filter((person) => person.consecutive);
  const below = complete.filter((person) =>
    person.averageWeekly! < person.goalWeekly * thresholdPct / 100,
  );
  return {
    status: eligible.length === 0 ? "no_selection" as const
      : missing.length ? "needs_data" as const
        : stale ? "stale" as const
        : below.length ? "below_threshold" as const
          : "review_hire" as const,
    selectedCount: eligible.length,
    missing,
    below,
    weeklyGap: below.reduce((total, person) =>
      total + person.goalWeekly * thresholdPct / 100 - person.averageWeekly!, 0,
    ),
    assessed,
  };
}

export type HiringForecastMonth = {
  date: string;
  clinicians: Record<string, { capacity?: number | null; utilization?: number | null }>;
};

export function firstHiringReviewMonth(
  months: HiringForecastMonth[],
  clinicianIds: number[],
  thresholdPct: number,
) {
  if (!clinicianIds.length) return null;
  return months.find((month) => clinicianIds.every((id) => {
    const clinician = month.clinicians[String(id)];
    return clinician && (clinician.capacity ?? 0) > 0 &&
      (clinician.utilization ?? -1) >= thresholdPct;
  }))?.date ?? null;
}
