import {
  daysInclusive,
  summarizeSessions,
  type SessionRecord,
} from "@workspace/practice";

type SessionGoalClinician = {
  id: number;
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

export function desiredSessionsForSelectedYear(
  record: SessionRecord,
  clinician: SessionGoalClinician | undefined,
  selectedYear: number,
) {
  if (!clinician || Number(record.end.slice(0, 4)) !== selectedYear)
    return record.desired;
  return desiredSessionsForPeriod(clinician.sessionsPerWeek, record);
}

export function withSelectedYearDesiredSessions(
  records: SessionRecord[],
  clinicians: SessionGoalClinician[],
  selectedYear: number,
) {
  return records.map((record) => {
    const desired = desiredSessionsForSelectedYear(
      record,
      clinicians.find((person) => person.id === record.clinicianId),
      selectedYear,
    );
    return desired === record.desired ? record : { ...record, desired };
  });
}

export function summarizeSessionsForSelectedYear(
  records: SessionRecord[],
  range: Range,
  clinician: SessionGoalClinician,
) {
  return summarizeSessions(
    withSelectedYearDesiredSessions(records, [clinician], sessionGoalYear(range)),
    range,
  );
}
