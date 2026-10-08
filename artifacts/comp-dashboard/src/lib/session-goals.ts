import {
  daysInclusive,
  summarizeSessions,
  type SessionRecord,
} from "@workspace/practice";

type SessionGoalClinician = {
  id: number;
  sessionsPerWeek: number;
};
export type SessionGoalYear = {
  clinicianId: number;
  year: number;
  sessionsPerWeek: number;
};

type Range = { start: string; end: string };

export const sessionGoalYear = (range: Range) => Number(range.end.slice(0, 4));

export function desiredSessionsForPeriod(
  sessionsPerWeek: number,
  period: Range,
) {
  return Math.round((sessionsPerWeek * daysInclusive(period.start, period.end)) / 7);
}

export function weeklyGoalFromPeriodDesired(
  desired: number,
  period: Range,
) {
  return (desired * 7) / daysInclusive(period.start, period.end);
}

export const sessionGoalUpdateForPeriod = (
  clinicianId: number,
  sessionsPerWeek: number,
  period: Range,
) => ({
  clinicianId,
  year: sessionGoalYear(period),
  sessionsPerWeek,
});

export const annualGoalFor = (
  clinicianId: number,
  year: number,
  goals: SessionGoalYear[],
) =>
  goals.find(
    (goal) => goal.clinicianId === clinicianId && goal.year === year,
  )?.sessionsPerWeek ?? null;

export function desiredSessionsForRecordYear(
  record: SessionRecord,
  _clinician: SessionGoalClinician | undefined,
  goals: SessionGoalYear[],
) {
  const sessionsPerWeek = annualGoalFor(
    record.clinicianId,
    sessionGoalYear(record),
    goals,
  );
  if (sessionsPerWeek !== null)
    return desiredSessionsForPeriod(sessionsPerWeek, record);
  return record.desired;
}

export function withAnnualDesiredSessions(
  records: SessionRecord[],
  clinicians: SessionGoalClinician[],
  goals: SessionGoalYear[],
) {
  return records.map((record) => {
    const desired = desiredSessionsForRecordYear(
      record,
      clinicians.find((person) => person.id === record.clinicianId),
      goals,
    );
    return desired === record.desired ? record : { ...record, desired };
  });
}

export function summarizeSessionsWithAnnualGoals(
  records: SessionRecord[],
  range: Range,
  clinician: SessionGoalClinician,
  goals: SessionGoalYear[],
) {
  return summarizeSessions(
    withAnnualDesiredSessions(records, [clinician], goals),
    range,
  );
}
