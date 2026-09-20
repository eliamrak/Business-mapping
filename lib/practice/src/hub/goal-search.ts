import {
  forecast,
  eventIssues,
  monthDate,
  monthEnd,
  type Context,
  type ForecastMonth,
} from "./engine.ts";
import {
  goalSearchSchema,
  eventSchema,
  type GoalSearch,
  type Workspace,
  type PlanEvent,
} from "./model.ts";

export type GoalCandidate = {
  events: PlanEvent[];
  date: string | null;
  start: string;
  hires: number;
  rooms: number;
  spend: number | null;
  minimumCash: number;
  additionalCash: number;
  achieved: number | null;
  feasible: boolean;
  monthlyCost: number;
  constraint: string;
  months: ForecastMonth[];
};
export type GoalSearchResult = {
  tested: number;
  feasible: number;
  best: GoalCandidate[];
  nearest: GoalCandidate | null;
};
const monthNumber = (date: string) =>
  Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

export function searchGoals(
  w: Workspace,
  context: Context,
  input: GoalSearch,
  makeId: () => string,
): GoalSearchResult {
  const s = goalSearchSchema.parse(input);
  if (
    monthDate(s.firstStart) < monthDate(w.settings.forecastStart) ||
    monthDate(s.deadline) >
      monthDate(w.settings.forecastStart, w.settings.horizonMonths - 1)
  )
    throw new Error("Search dates must be inside the active forecast horizon.");
  const profiles = s.hiring.map((choice) => {
    const profile = w.hiring.find(
      (h) => h.id === choice.profileId && !h.archived,
    );
    if (
      !profile ||
      !context.clinicians.some((c) => c.id === profile.templateClinicianId)
    )
      throw new Error(
        "A hiring profile or compensation template is unavailable.",
      );
    return { ...choice, profile };
  });
  if (s.roomId && !w.rooms.some((r) => r.id === s.roomId && !r.archived))
    throw new Error("Choose an available room template.");
  if (
    s.campaignId &&
    !w.campaigns.some((c) => c.id === s.campaignId && !c.archived)
  )
    throw new Error("Choose an available campaign.");
  const startCount = monthNumber(s.lastStart) - monthNumber(s.firstStart) + 1;
  const spendCount = s.campaignId
    ? Math.floor((s.spendMax - s.spendMin) / s.spendStep) + 1
    : 1;
  const combinations =
    startCount *
    spendCount *
    (s.maxRooms + 1) *
    profiles.reduce((n, h) => n * (h.maxCount + 1), 1);
  if (combinations > 500)
    throw new Error(
      `${combinations.toLocaleString()} combinations. Narrow the ranges or increase the spend step to test at most 500.`,
    );
  const mixes: number[][] = [[]];
  for (const profile of profiles) {
    const previous = mixes.splice(0);
    previous.forEach((mix) => {
      for (let count = 0; count <= profile.maxCount; count++)
        mixes.push([...mix, count]);
    });
  }
  const feasible: GoalCandidate[] = [];
  let nearest: GoalCandidate | null = null,
    tested = 0;
  const deadline =
    monthNumber(s.deadline) - monthNumber(w.settings.forecastStart);
  for (let offset = 0; offset < startCount; offset++)
    for (const mix of mixes)
      for (let rooms = 0; rooms <= s.maxRooms; rooms++)
        for (let sp = 0; sp < spendCount; sp++) {
          const start = monthDate(s.firstStart, offset);
          const events: PlanEvent[] = [];
          profiles.forEach(({ profile: h }, i) => {
            for (let n = 0; n < mix[i]; n++)
              events.push(
                eventSchema.parse({
                  id: makeId(),
                  name: `${h.name} ${n + 1}`,
                  date: start,
                  field: "clinician.hire",
                  targetId: String(h.templateClinicianId),
                  value: h.desiredWeeklySessions,
                  delayMonths: h.delayMonths,
                  rampMonths: h.rampMonths,
                  monthlyCost: h.monthlySupport,
                  oneTimeCost:
                    h.recruiting +
                    h.credentialing +
                    h.training +
                    h.equipment +
                    h.preCaseloadPay,
                }),
              );
          });
          if (rooms && s.roomId)
            events.push(
              eventSchema.parse({
                id: makeId(),
                name: `${rooms} additional rooms`,
                date: start,
                field: "room.add",
                targetId: s.roomId,
                value: rooms,
                oneTimeCost: rooms * s.roomSetupCost,
                monthlyCost: rooms * s.roomMonthlyCost,
              }),
            );
          const spend = s.campaignId ? s.spendMin + sp * s.spendStep : null;
          if (s.campaignId)
            events.push(
              eventSchema.parse({
                id: makeId(),
                name: "Campaign budget",
                date: start,
                field: "marketing.spend",
                targetId: s.campaignId,
                value: spend,
              }),
            );
          if (eventIssues([...w.events, ...events]).length) {
            tested++;
            continue;
          }
          const months = forecast(w, context, events, 1, false);
          let achievedAt: number | null = null;
          for (let i = 0; i + s.sustainMonths - 1 <= deadline; i++) {
            if (
              months.slice(i, i + s.sustainMonths).every((m) => {
                const value = m.values[s.metric];
                return value != null && value >= s.target;
              })
            ) {
              achievedAt = i;
              break;
            }
          }
          const minimumCash = Math.min(
            w.settings.openingCash,
            ...months
              .slice(0, deadline + 1)
              .map((m) => m.values.cash ?? -Infinity),
          );
          const at = months[achievedAt ?? deadline];
          const candidate: GoalCandidate = {
            events,
            date: achievedAt === null ? null : at.date,
            start,
            hires: mix.reduce((n, c) => n + c, 0),
            rooms,
            spend,
            minimumCash,
            additionalCash: Math.max(0, s.minimumCash - minimumCash),
            achieved: at.values[s.metric] ?? null,
            feasible: achievedAt !== null && minimumCash >= s.minimumCash,
            monthlyCost: [
              "clinicianPay",
              "employerBurden",
              "overhead",
              "marketing",
              "staffCost",
              "ownerPayroll",
              "fees",
            ].reduce((n, key) => n + (at.values[key] ?? 0), 0),
            constraint: at.constraint,
            months,
          };
          tested++;
          if (candidate.feasible) feasible.push(candidate);
          if (
            !nearest ||
            (candidate.achieved ?? -Infinity) >
              (nearest.achieved ?? -Infinity) ||
            (candidate.achieved === nearest.achieved &&
              candidate.additionalCash < nearest.additionalCash)
          )
            nearest = candidate;
        }
  const cost = (c: GoalCandidate) =>
    s.objective === "fewest_hires"
      ? c.hires
      : s.objective === "lowest_cost"
        ? c.monthlyCost
        : monthNumber(c.date!);
  feasible.sort(
    (a, b) =>
      cost(a) - cost(b) ||
      a.monthlyCost - b.monthlyCost ||
      a.hires - b.hires ||
      a.start.localeCompare(b.start),
  );
  return {
    tested,
    feasible: feasible.length,
    best: feasible.slice(0, 10),
    nearest: feasible.length ? null : nearest,
  };
}
