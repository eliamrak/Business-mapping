import { daysInclusive } from "@workspace/practice";
import {
  forecast,
  monthDate,
  observedSessionPace,
  type Context,
  type ForecastMonth,
  type Workspace,
  type PaceCoverage,
} from "@workspace/practice/hub";

export type PracticeView = "plan" | "actual";

export type ClinicianPace = {
  id: number;
  name: string;
  desiredWeekly: number;
  recordedWeekly: number | null;
  usedWeekly: number | null;
  basis: string;
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
  attendanceCoverage: PaceCoverage[] = [],
): {
  projectionWorkspace: Workspace;
  months: ForecastMonth[];
  clinicianPace: ClinicianPace[];
  recentPeriods: SessionPeriod[];
  planWeekly: number;
  projectedWeekly: number | null;
  recentStart: string;
} {
  const clinicians = context.clinicians.filter(
    (person) => (person.goalId ?? null) === workspace.settings.teamId,
  );
  const completedBiweekly = [...new Map(context.sessions
    .filter((record) =>
      clinicians.some((person) => person.id === record.clinicianId) &&
      record.end <= today && daysInclusive(record.start, record.end) === 14,
    )
    .map((record) => [`${record.start}|${record.end}`, { start: record.start, end: record.end }]))
    .values()]
    .sort((a, b) => b.end.localeCompare(a.end))
    .slice(0, 4);
  const exactFour = completedBiweekly.length === 4 &&
    daysInclusive(completedBiweekly[0].end, today) <= 28 &&
    completedBiweekly.every((period, index) =>
      (index === 0 || dayBefore(completedBiweekly[index - 1].start, 1) === period.end) &&
      clinicians.every((person) => context.sessions.some((record) =>
        record.clinicianId === person.id &&
        record.start === period.start && record.end === period.end,
      )),
    );
  const recentStart = exactFour ? completedBiweekly[3].start : dayBefore(today, 55);
  const clinicianPace = clinicians.map((person) => {
    const profile = workspace.clinicians.find((entry) => entry.clinicianId === person.id);
    const inactive = profile?.status === "planned" || profile?.status === "archived" || (profile && (profile.start > today || (profile.end !== null && profile.end < monthDate(today))));
    const pace = observedSessionPace(context.sessions, person.id, today, recentStart, attendanceCoverage);
    return {
      id: person.id,
      name: person.label,
      desiredWeekly: person.sessionsPerWeek,
      recordedWeekly: pace.weekly,
      usedWeekly: inactive ? 0 : pace.weekly,
      basis: inactive ? "no existing-caseload baseline for inactive or planned clinician" : `${pace.historicalFallback ? `historical fallback ${pace.windowStart} to ${pace.windowEnd}: ` : ""}${pace.basis}`,
      recordedDays: pace.recordedDays,
      recordedThrough: pace.through,
    };
  });
  const planWeekly = clinicianPace.reduce(
    (sum, person) => sum + person.desiredWeekly,
    0,
  );
  const projectedWeekly = clinicianPace.length && clinicianPace.every((person) => person.usedWeekly !== null)
    ? clinicianPace.reduce((sum, person) => sum + person.usedWeekly!, 0) : null;
  const plannedBaseline =
    workspace.settings.baselineMode === "manual" &&
    workspace.settings.baselineWeeklySessions !== null
      ? workspace.settings.baselineWeeklySessions
      : planWeekly;
  const projectionWorkspace: Workspace = {
    ...workspace,
    settings: {
      ...workspace.settings,
      forecastStart: view === "actual" ? monthDate(today) : workspace.settings.forecastStart,
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
        }
      }
      period.total = period.recorded + period.estimated;
      return period;
    });

  const months = view === "actual" && projectedWeekly === null ? [] : forecast(
    projectionWorkspace,
    context,
    [],
    1,
    true,
    view === "actual"
      ? {
          useImportedBillingActuals: false,
          baselineWeeklyByClinician: Object.fromEntries(
            clinicianPace.map((person) => [person.id, person.usedWeekly!]),
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
