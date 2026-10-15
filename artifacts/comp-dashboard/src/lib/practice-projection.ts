import {
  forecast,
  monthDate,
  workingSessionPace,
  rollingThreeMonthStart,
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
  const recentStart = rollingThreeMonthStart(today);
  const clinicianPace = clinicians.map((person) => {
    const profile = workspace.clinicians.find((entry) => entry.clinicianId === person.id);
    const inactive = profile?.onTeam === false || profile?.status === "planned" || profile?.status === "archived" || (profile && (profile.start > today || (profile.end !== null && profile.end < monthDate(today))));
    const pace = workingSessionPace(context.sessions, person.id, today, attendanceCoverage);
    return {
      id: person.id,
      name: person.label,
      desiredWeekly: person.sessionsPerWeek,
      recordedWeekly: pace.weekly,
      usedWeekly: inactive ? 0 : pace.weekly,
      basis: inactive ? "not on the current team" : `${pace.windowStart} to ${pace.windowEnd}: ${pace.basis} (${pace.denominatorDays} calendar days)`,
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
          workingForecast: true,
          useImportedBillingActuals: true,
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
