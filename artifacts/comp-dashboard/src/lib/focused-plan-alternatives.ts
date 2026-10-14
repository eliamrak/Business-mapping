import { forecast, type Context, type ForecastMonth, type Values, type Workspace } from "@workspace/practice/hub";
import type { PracticeCopy } from "./practice-goals.ts";
import { planInputSignature } from "./plan-focus.ts";

export type FocusedPlanInputs = {
  /** Explicit null means unknown; omission uses the current configured goal. */
  profitMonthly?: number | null;
  sessionsMonthly?: number | null;
  /** Optional user-entered hypothesis, never an inferred clinical preference. */
  inPersonPct?: number | null;
};

export type FocusedPlanPriority = {
  metric: "sessions" | "profit" | "roomDemandCoverage";
  basis: string;
  period: string | null;
  unit: "sessions" | "currency";
  base: number | null;
  target: number | null;
  shortfall: number | null;
  /** Fractional shortfall, not a weighted score. Undefined for a zero target. */
  relativeGap: number | null;
};

export type FocusedPlanAlternative = {
  id: "session-capacity" | "profit-goal" | "room-fit";
  name: string;
  focusKpis: ("Sessions" | "Revenue" | "Profit" | "Rooms")[];
  status: "modeled" | "focus-only";
  reason: string;
  practiceCopy: PracticeCopy;
  /** Alias for integration with snapshot-based editors; not a saved Proposal. */
  snapshot: PracticeCopy;
  assumptions: string[];
  unknowns: string[];
  forecast: ForecastMonth[] | null;
  /** First forecast month, so current monthly goals have matching units. */
  values: Values;
  deltas: Values;
  assumptionSignature: string;
  priority: FocusedPlanPriority;
  /** Competition rank: tied gaps share rank; unevidenced options have no rank. */
  rank: number | null;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const displayNumber = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const displayMoney = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const measureKeys = ["sessions", "capacity", "revenue", "profit", "roomCapacity", "roomUtilization", "unservedSessions"] as const;
const unknownValues = (): Values => Object.fromEntries(measureKeys.map((key) => [key, null]));

/** Sort independent copies by evidenced fractional gaps. Ties retain input order. */
export function rankFocusedPlanAlternatives(options: readonly FocusedPlanAlternative[]): FocusedPlanAlternative[] {
  const eligible = (option: FocusedPlanAlternative) => option.status === "modeled" && option.forecast !== null
    && finite(option.priority.base) && finite(option.priority.target) && option.priority.target > 0
    && nonnegative(option.priority.shortfall) && nonnegative(option.priority.relativeGap);
  const ranked = structuredClone([...options]).map((option, index) => ({ option, index }));
  ranked.sort((a, b) => {
    const aKnown = eligible(a.option), bKnown = eligible(b.option);
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    return (aKnown ? b.option.priority.relativeGap! - a.option.priority.relativeGap! : 0) || a.index - b.index;
  });
  let previousGap: number | null = null;
  let rank: number | null = null;
  return ranked.map(({ option }, index) => {
    if (!eligible(option)) return { ...option, rank: null };
    if (option.priority.relativeGap !== previousGap) rank = index + 1;
    previousGap = option.priority.relativeGap;
    return { ...option, rank };
  });
}

/** Pure, unsaved hypotheses. Never selects, replaces, or approves saved plans. */
export function createFocusedPlanAlternatives(
  workspace: Workspace,
  context: Context,
  input: FocusedPlanInputs = {},
): [FocusedPlanAlternative, FocusedPlanAlternative, FocusedPlanAlternative] {
  const source = structuredClone({ workspace, context });
  const people = source.context.clinicians.filter((person) =>
    workspace.settings.teamId === null ? person.goalId == null : person.goalId === workspace.settings.teamId,
  );
  const run = (copy: PracticeCopy, firstOnly = false) => forecast(
    firstOnly ? { ...copy.workspace, settings: { ...copy.workspace.settings, horizonMonths: 1 } } : copy.workspace,
    copy.context, [], 1, false,
  );
  const baseline = run(source, true)[0];
  const base = baseline?.values ?? unknownValues();
  const weeks = baseline ? new Date(Date.UTC(Number(baseline.date.slice(0, 4)), Number(baseline.date.slice(5, 7)), 0)).getUTCDate() / 7 : null;
  const capacity = people.length && nonnegative(base.capacity) ? base.capacity : null;
  const profitGoals = workspace.goals.filter((goal) => !goal.archived && goal.metric === "profit");
  const profitTarget = input.profitMonthly !== undefined ? input.profitMonthly
    : profitGoals.length === 1 ? profitGoals[0].amount / (profitGoals[0].basis === "annual" ? 12 : 1)
      : profitGoals.length > 1 ? null : workspace.settings.targetProfitMonthly;
  const baselineUnknown = !baseline || baseline.warnings.some((warning) => /Baseline sessions are missing|Historical session coverage is incomplete/.test(warning));
  // Do not publish numeric results from engine fallbacks for missing business inputs.
  const modelUnknowns = (month: ForecastMonth | undefined) => month?.warnings.filter((warning) =>
    /missing|unknown|incomplete|unavailable|unverified|not found|choose|must be/i.test(warning),
  ) ?? ["Forecast period is unknown."];
  const baselineEvidenced = !baselineUnknown && !modelUnknowns(baseline).length;
  const priorityFor = (id: FocusedPlanAlternative["id"]): FocusedPlanPriority => {
    const roomDemand = nonnegative(base.sessions) && nonnegative(base.unservedSessions)
      ? base.sessions + base.unservedSessions : null;
    const attainableRoomDemand = roomDemand !== null && capacity !== null ? Math.min(roomDemand, capacity) : null;
    const metric = id === "session-capacity" ? "sessions" : id === "profit-goal" ? "profit" : "roomDemandCoverage";
    const target = id === "session-capacity" ? capacity : id === "profit-goal"
      ? nonnegative(profitTarget) ? profitTarget : null
      : baselineEvidenced && nonnegative(base.roomCapacity) ? attainableRoomDemand : null;
    const current = id === "session-capacity" ? base.sessions : id === "profit-goal" ? base.profit
      : target !== null ? baseline?.constraint === "Room capacity" ? base.sessions : target : null;
    const evidencedBase = baselineEvidenced && finite(current) ? current : null;
    const shortfall = evidencedBase !== null && target !== null ? Math.max(0, target - evidencedBase) : null;
    return {
      metric, unit: metric === "profit" ? "currency" : "sessions", period: baseline?.date ?? null,
      basis: metric === "sessions" ? "Current modeled sessions versus configured clinician capacity in the first forecast month."
        : metric === "profit" ? "Current modeled profit versus the resolved monthly profit goal in the first forecast month."
          : "Clinically attainable demand is min(total current demand, configured clinician capacity). When Room capacity binds, shortfall is max(0, clinically attainable demand - delivered sessions): an upper bound on room-related recovery, not an exact recovery forecast. Otherwise no binding room shortfall is evidenced.",
      base: evidencedBase, target, shortfall,
      relativeGap: shortfall !== null && target !== null && target > 0 ? shortfall / target : null,
    };
  };

  const build = (
    id: FocusedPlanAlternative["id"], name: string, focusKpis: FocusedPlanAlternative["focusKpis"],
    edit: (copy: PracticeCopy, assumptions: string[], unknowns: string[]) => boolean,
  ): FocusedPlanAlternative => {
    const practiceCopy = structuredClone(source);
    const assumptions: string[] = [];
    const unknowns: string[] = [];
    const ready = edit(practiceCopy, assumptions, unknowns);
    let rows = ready ? run(practiceCopy) : null;
    if (rows) {
      unknowns.push(...rows.flatMap(modelUnknowns));
      if (unknowns.length) rows = null;
    }
    const values = rows?.[0]?.values ?? unknownValues();
    const deltas: Values = Object.fromEntries(measureKeys.map((key) => [key,
      !baselineUnknown && !modelUnknowns(baseline).length && finite(values[key]) && finite(base[key]) ? values[key]! - base[key]! : null,
    ]));
    if (baselineUnknown) unknowns.push("Current session baseline is unknown; comparative deltas remain unknown.");
    return {
      id, name, focusKpis, status: rows ? "modeled" : "focus-only",
      reason: rows ? "Conditional modeled draft using configured inputs; review before saving or adopting."
        : "Focus recommendation only. Edit the unknown inputs to model this alternative; no forecast has been fabricated.",
      practiceCopy, snapshot: practiceCopy, assumptions,
      unknowns: [...new Set(unknowns)], forecast: rows, values, deltas,
      assumptionSignature: planInputSignature({ id, focusKpis, practiceCopy, input }),
      priority: priorityFor(id), rank: null,
    };
  };

  const setSessions = (copy: PracticeCopy, monthly: number, assumptions: string[]) => {
    copy.workspace.settings.baselineMode = "manual";
    copy.workspace.settings.baselineWeeklySessions = monthly / weeks!;
    assumptions.push(`Model ${displayNumber(monthly)} baseline sessions in ${baseline.date.slice(0, 7)} (${displayNumber(monthly / weeks!)} / week); this is a demand hypothesis, not recorded activity.`);
    assumptions.push("Existing acquisition, retention, clinician compensation, owner pay, and dated constraints remain in the engine model; realized sessions may differ from this baseline hypothesis.");
  };

  const sessions = build("session-capacity", "Fill configured session capacity", ["Sessions", "Revenue"], (copy, assumptions, unknowns) => {
    if (capacity === null || !weeks) { unknowns.push("Configure the selected team's clinician capacity and forecast period."); return false; }
    const target = input.sessionsMonthly !== undefined ? input.sessionsMonthly : capacity;
    if (!nonnegative(target)) { unknowns.push("Monthly session target is unknown; edit the session hypothesis."); return false; }
    assumptions.push(`Configured clinician capacity is ${displayNumber(capacity)} sessions in ${baseline.date.slice(0, 7)}; no clinician hours or headcount are added.`);
    if (target > capacity) unknowns.push("The requested session target exceeds configured clinician capacity.");
    setSessions(copy, Math.min(target, capacity), assumptions);
    return true;
  });

  const profit = build("profit-goal", "Test the current profit goal", ["Profit", "Sessions"], (copy, assumptions, unknowns) => {
    if (!nonnegative(profitTarget)) { unknowns.push("Monthly profit target is unknown or multiple current profit goals conflict; enter a target."); return false; }
    if (capacity === null || !weeks) { unknowns.push("Configure clinician capacity before testing the financial goal."); return false; }
    const missing = modelUnknowns(baseline).filter((warning) => !/Baseline sessions are missing|Historical session coverage is incomplete/.test(warning));
    if (missing.length) { unknowns.push(...missing); return false; }
    assumptions.push(`Current profit goal is ${displayMoney(profitTarget)} / month${input.profitMonthly === undefined && profitGoals.length === 1 && profitGoals[0].basis === "annual" ? "; annual goal divided by 12" : ""}.`);
    assumptions.push("Search baseline demand between zero and configured first-month clinician capacity; fees, pay, overhead, acquisition and owner payroll are unchanged.");
    copy.workspace.settings.baselineMode = "manual";
    const evaluate = (monthly: number) => {
      copy.workspace.settings.baselineWeeklySessions = monthly / weeks!;
      return run(copy, true)[0]?.values.profit;
    };
    let low = 0, high = capacity;
    const lowerProfit = evaluate(low), upperProfit = evaluate(high);
    if (!finite(lowerProfit) || !finite(upperProfit)) { unknowns.push("Current unit economics do not support a profit forecast."); return false; }
    if (lowerProfit >= profitTarget) high = 0;
    else if (upperProfit < profitTarget) {
      setSessions(copy, capacity, assumptions);
      assumptions.push(`Configured capacity projects ${displayMoney(upperProfit)} profit / month; the ${displayMoney(profitTarget)} goal is not met by this lever.`);
      return true;
    } else {
      // Bounded search, with the dated engine evaluating each hypothesis.
      for (let step = 0; step < 18; step++) {
        const middle = (low + high) / 2;
        const value = evaluate(middle);
        if (!finite(value)) { unknowns.push("Profit becomes unknown within the configured capacity range."); return false; }
        if (value >= profitTarget) high = middle; else low = middle;
      }
    }
    setSessions(copy, high, assumptions);
    return true;
  });

  const rooms = build("room-fit", "Match room capacity to session demand", ["Rooms", "Sessions"], (copy, assumptions, unknowns) => {
    const activeRooms = workspace.rooms.filter((room) => !room.archived && !room.planningOnly && room.start && room.start <= baseline?.date && (!room.end || room.end >= baseline.date));
    if (capacity === null || !weeks || !activeRooms.length || !nonnegative(base.roomCapacity)) {
      unknowns.push("Configured active room capacity and clinician capacity are needed for a room-fit model."); return false;
    }
    if (input.inPersonPct === null) { unknowns.push("In-person mix hypothesis is unknown; edit it before modeling."); return false; }
    if (input.inPersonPct !== undefined && (!nonnegative(input.inPersonPct) || input.inPersonPct > 100)) {
      unknowns.push("In-person mix hypothesis must be between 0 and 100 percent."); return false;
    }
    if (activeRooms.some((room) => room.telehealthUsesRoom) && input.inPersonPct === undefined) {
      unknowns.push("Telehealth also uses configured rooms; enter a mix hypothesis and review room assignments."); return false;
    }
    const fitPct = capacity > 0 ? Math.min(100, base.roomCapacity / capacity * 100) : workspace.settings.defaultInPersonPct;
    const pct = input.inPersonPct ?? fitPct;
    assumptions.push(`Configured rooms provide ${displayNumber(base.roomCapacity)} sessions / month against ${displayNumber(capacity)} clinician sessions / month.`);
    assumptions.push(`Test an in-person ceiling of ${displayNumber(pct)}%; this is a hypothetical mix requiring user review, not a change to clinical preferences or recorded visits.`);
    copy.workspace.settings.defaultInPersonPct = Math.min(workspace.settings.defaultInPersonPct, pct);
    copy.workspace.clinicians = copy.workspace.clinicians.map((profile) => people.some((person) => person.id === profile.clinicianId)
      ? { ...profile, inPersonPct: Math.min(profile.inPersonPct, pct) } : profile);
    setSessions(copy, capacity, assumptions);
    assumptions.push("Existing room hours, locations, assignments and availability still constrain the forecast; aggregate room fit does not guarantee individual room access.");
    return true;
  });
  return rankFocusedPlanAlternatives([sessions, profit, rooms]) as [FocusedPlanAlternative, FocusedPlanAlternative, FocusedPlanAlternative];
}
