import { daysInclusive } from "@workspace/practice";
import type { Context, Workspace } from "@workspace/practice/hub";

export type MonthlyCaseloadSample = {
  month: string;
  sessions: number;
  newClients: number;
};

const nextMonth = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
};

export function inferMonthlyAttrition(
  samples: MonthlyCaseloadSample[],
  sessionsPerClientMonth: number,
) {
  if (!(sessionsPerClientMonth > 0)) return null;
  const ordered = [...samples].sort((a, b) => a.month.localeCompare(b.month));
  let first = ordered.length - 1;
  while (first > 0 && nextMonth(ordered[first - 1].month) === ordered[first].month)
    first--;
  const recent = ordered.slice(Math.max(first, ordered.length - 12));
  if (recent.length < 4) return null;
  const pairs = recent.slice(1).flatMap((current, index) => {
    const prior = recent[index];
    const priorActive = prior.sessions / sessionsPerClientMonth;
    const currentActive = current.sessions / sessionsPerClientMonth;
    if (priorActive <= 0) return [];
    return [{ priorActive, retainedActive: currentActive - current.newClients / 2 }];
  });
  const numerator = pairs.reduce(
    (sum, pair) => sum + pair.priorActive * pair.retainedActive, 0,
  );
  const denominator = pairs.reduce(
    (sum, pair) => sum + pair.priorActive ** 2, 0,
  );
  const retention = numerator / denominator;
  if (!Number.isFinite(retention) || retention < 0 || retention > 1) return null;
  return {
    attritionPct: (1 - retention) * 100,
    months: recent.length,
    through: recent.at(-1)!.month,
  };
}

export function estimatePracticeAttrition(
  context: Context,
  workspace: Workspace,
  teamId: number | null,
  today: string,
) {
  const people = context.clinicians.filter((person) =>
    (person.goalId ?? null) === teamId && person.sessionsPerWeek > 0,
  );
  if (!people.length) return null;
  const completeThrough = today.slice(0, 7);
  const samples: MonthlyCaseloadSample[] = [];
  for (const period of workspace.periods) {
    const month = period.start.slice(0, 7);
    if (period.archived || month >= completeThrough ||
      period.start !== month + "-01" || period.end.slice(0, 7) !== month ||
      !period.funnelComplete) continue;
    const [year, monthNumber] = month.split("-").map(Number);
    const monthDays = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    if (period.end !== `${month}-${String(monthDays).padStart(2, "0")}`) continue;
    const funnels = workspace.funnels.filter((item) => item.periodId === period.id);
    if (!funnels.length || funnels.some((item) => item.clients === null)) continue;
    let sessions = 0;
    const completeCoverage = people.every((person) => {
      const records = context.sessions.filter((record) =>
        record.clinicianId === person.id &&
        record.start <= period.end && record.end >= period.start,
      );
      const covered = records.reduce((sum, record) => {
        const overlap = daysInclusive(
          record.start > period.start ? record.start : period.start,
          record.end < period.end ? record.end : period.end,
        );
        sessions += record.completed * overlap / daysInclusive(record.start, record.end);
        return sum + overlap;
      }, 0);
      return covered === monthDays;
    });
    if (!completeCoverage) continue;
    samples.push({
      month,
      sessions,
      newClients: funnels.reduce((sum, item) => sum + (item.clients ?? 0), 0),
    });
  }
  if (new Set(samples.map((sample) => sample.month)).size !== samples.length)
    return null;
  const latest = samples.map((sample) => sample.month).sort().at(-1);
  if (!latest) return null;
  const monthIndex = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
  if (monthIndex(completeThrough) - monthIndex(latest) > 2) return null;
  return inferMonthlyAttrition(samples, workspace.settings.sessionsPerClientMonth);
}
