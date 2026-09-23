import { daysInclusive } from "@workspace/practice";
import {
  forecast,
  monthDate,
  type Context,
  type ForecastMonth,
  type Workspace,
} from "@workspace/practice/hub";

export type PracticeView = "plan" | "actual";

export type ClinicianPace = {
  id: number;
  name: string;
  desiredWeekly: number;
  recordedWeekly: number | null;
  usedWeekly: number;
  recordedDays: number;
  recordedThrough: string | null;
};

export type SessionPeriod = {
  start: string;
  end: string;
  recorded: number;
  estimated: number;
  total: number;
  recordedClinicians: number;
  clinicianCount: number;
};

const dayBefore = (date: string, days: number) =>
  new Date(Date.parse(date + "T12:00:00Z") - days * 86_400_000)
    .toISOString()
    .slice(0, 10);

export function buildPracticeProjection(
  workspace: Workspace,
  context: Context,
  view: PracticeView,
  today: string,
): {
  projectionWorkspace: Workspace;
  months: ForecastMonth[];
  clinicianPace: ClinicianPace[];
  recentPeriods: SessionPeriod[];
  planWeekly: number;
  projectedWeekly: number;
  recentStart: string;
} {
  const clinicians = context.clinicians.filter(
    (person) => (person.goalId ?? null) === workspace.settings.teamId,
  );
  const recentStart = dayBefore(today, 55);
  const windowDays = daysInclusive(recentStart, today);
  const clinicianPace = clinicians.map((person) => {
    const recent = context.sessions.filter(
      (record) =>
        record.clinicianId === person.id &&
        record.start >= recentStart &&
        record.end <= today,
    );
    const days = recent.reduce(
      (sum, record) => sum + daysInclusive(record.start, record.end),
      0,
    );
    const completed = recent.reduce((sum, record) => sum + record.completed, 0);
    const recordedWeekly = days ? (completed * 7) / days : null;
    const usedWeekly =
      ((completed +
        (person.sessionsPerWeek * Math.max(0, windowDays - days)) / 7) *
        7) /
      windowDays;
    return {
      id: person.id,
      name: person.label,
      desiredWeekly: person.sessionsPerWeek,
      recordedWeekly,
      usedWeekly,
      recordedDays: days,
      recordedThrough: recent.reduce<string | null>(
        (latest, record) =>
          latest === null || record.end > latest ? record.end : latest,
        null,
      ),
    };
  });
  const planWeekly = clinicianPace.reduce(
    (sum, person) => sum + person.desiredWeekly,
    0,
  );
  const projectedWeekly = clinicianPace.reduce(
    (sum, person) => sum + person.usedWeekly,
    0,
  );
  const plannedBaseline =
    workspace.settings.baselineMode === "manual" &&
    workspace.settings.baselineWeeklySessions !== null
      ? workspace.settings.baselineWeeklySessions
      : planWeekly;
  const projectionWorkspace: Workspace = {
    ...workspace,
    settings: {
      ...workspace.settings,
      forecastStart:
        view === "actual" &&
        workspace.settings.forecastStart < monthDate(today, 1)
          ? monthDate(today, 1)
          : workspace.settings.forecastStart,
      baselineMode: "manual",
      baselineWeeklySessions:
        view === "actual" ? projectedWeekly : plannedBaseline,
    },
  };

  const periods = new Map<string, SessionPeriod>();
  for (const record of context.sessions) {
    if (
      record.start < recentStart ||
      record.end > today ||
      !clinicians.some((person) => person.id === record.clinicianId)
    )
      continue;
    const key = record.start + "|" + record.end;
    if (!periods.has(key))
      periods.set(key, {
        start: record.start,
        end: record.end,
        recorded: 0,
        estimated: 0,
        total: 0,
        recordedClinicians: 0,
        clinicianCount: clinicians.length,
      });
  }
  const recentPeriods = [...periods.values()]
    .sort((a, b) => b.end.localeCompare(a.end))
    .slice(0, 4)
    .map((period) => {
      const days = daysInclusive(period.start, period.end);
      for (const person of clinicians) {
        const record = context.sessions.find(
          (item) =>
            item.clinicianId === person.id &&
            item.start === period.start &&
            item.end === period.end,
        );
        if (record) {
          period.recorded += record.completed;
          period.recordedClinicians++;
        } else {
          period.estimated += (person.sessionsPerWeek * days) / 7;
        }
      }
      period.total = period.recorded + period.estimated;
      return period;
    });

  const months = forecast(
    projectionWorkspace,
    context,
    [],
    1,
    true,
    view === "actual"
      ? {
          baselineWeeklyByClinician: Object.fromEntries(
            clinicianPace.map((person) => [person.id, person.usedWeekly]),
          ),
        }
      : {},
  );
  return {
    projectionWorkspace,
    months,
    clinicianPace,
    recentPeriods,
    planWeekly,
    projectedWeekly,
    recentStart,
  };
}
