import { daysInclusive, type SessionRecord } from "@workspace/practice";

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
