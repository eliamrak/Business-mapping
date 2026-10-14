import test from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, forecast, goalSchema, proposalSchema, roomSchema, type Context } from "@workspace/practice/hub";
import { createFocusedPlanAlternatives, rankFocusedPlanAlternatives, type FocusedPlanAlternative } from "./focused-plan-alternatives.ts";
import { makePlanningScenario, readPracticeGoal, validatePracticeCopy } from "./practice-goals.ts";

function fixture() {
  const workspace = emptyWorkspace("2026-10-14");
  Object.assign(workspace.settings, {
    forecastStart: "2026-11-01", horizonMonths: 2,
    baselineMode: "manual", baselineWeeklySessions: 5,
    baselineRetentionPct: 100, attendancePct: 100,
    organicClientsPerMonth: 0, overheadMode: "detailed",
    targetProfitMonthly: 600, defaultInPersonPct: 100,
  });
  const context: Context = {
    clinicians: [{
      id: 1, label: "Configured clinician", goalId: null,
      sessionRate: 120, sessionsPerWeek: 20, weeksWorkedPerYear: 48,
      classification: "1099", capEnabled: false, capAmount: 0,
      preCapClinicianSplit: 60, preCapPracticeSplit: 40,
      postCapClinicianSplit: 60, postCapPracticeSplit: 40,
      w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0,
    }], staff: [], sessions: [],
    importedBillingActuals: [{ clinicianId: 1, serviceDate: "2026-10-01", totalFeeCharged: 120, sourceRowHash: "actual" }],
  };
  workspace.rooms.push(roomSchema.parse({
    id: crypto.randomUUID(), name: "Configured room", start: "2026-01-01",
    weeklyHours: 8, sessionMinutes: 60, usablePct: 100,
  }));
  workspace.proposals.push(proposalSchema.parse({ id: crypto.randomUUID(), name: "Legacy goal", baseline: { legacy: [1, 2, 3] } }));
  workspace.proposals.push(makePlanningScenario("Saved independent plan", { workspace, context }, 7, "today"));
  return { workspace, context };
}

const byId = (options: readonly FocusedPlanAlternative[], id: FocusedPlanAlternative["id"]) => {
  const option = options.find((option) => option.id === id);
  assert.ok(option, `Missing alternative ${id}`);
  return option;
};

test("three distinct modeled focuses derive from real capacity, profit goal and rooms", () => {
  const source = fixture();
  const options = createFocusedPlanAlternatives(source.workspace, source.context);
  assert.equal(options.length, 3);
  assert.equal(new Set(options.map((option) => option.id)).size, 3);
  assert.equal(new Set(options.map((option) => option.name)).size, 3);
  assert.equal(new Set(options.map((option) => option.focusKpis.join("|"))).size, 3);
  for (const option of options) {
    assert.ok(option.focusKpis.length >= 1 && option.focusKpis.length <= 2);
    assert.equal(option.status, "modeled", JSON.stringify(option.unknowns));
    assert.deepEqual(option.forecast, forecast(option.practiceCopy.workspace, option.practiceCopy.context, [], 1, false));
  }
  const sessions = byId(options, "session-capacity"), profit = byId(options, "profit-goal"), rooms = byId(options, "room-fit");
  const base = forecast(source.workspace, source.context, [], 1, false)[0].values;
  assert.equal(sessions.practiceCopy.workspace.settings.baselineWeeklySessions, base.capacity! / (30 / 7));
  assert.ok(profit.values.profit! >= 600);
  assert.ok(profit.practiceCopy.workspace.settings.baselineWeeklySessions! < sessions.practiceCopy.workspace.settings.baselineWeeklySessions!);
  assert.ok(rooms.practiceCopy.workspace.settings.defaultInPersonPct < 100);
  assert.ok(rooms.values.sessions! > sessions.values.sessions!);
  assert.equal(rooms.practiceCopy.workspace.rooms[0].weeklyHours, 8);
  assert.ok(sessions.assumptions.some((assumption) => assumption.includes(base.capacity!.toLocaleString("en-US", { maximumFractionDigits: 2 }))));
  assert.ok(rooms.assumptions.some((assumption) => assumption.includes(base.roomCapacity!.toLocaleString("en-US", { maximumFractionDigits: 2 }))));
  assert.equal(sessions.deltas.sessions, sessions.values.sessions! - base.sessions!);
});

test("every input array, legacy goal and saved plan is preserved and copies are isolated", () => {
  const source = fixture(), before = structuredClone(source);
  const options = createFocusedPlanAlternatives(source.workspace, source.context);
  assert.deepEqual(source, before);
  for (const option of options) {
    assert.deepEqual(option.practiceCopy.workspace.proposals, before.workspace.proposals);
    assert.deepEqual(option.practiceCopy.workspace.goals, before.workspace.goals);
    assert.deepEqual(option.practiceCopy.context, before.context);
    assert.notEqual(option.practiceCopy.workspace.proposals, source.workspace.proposals);
  }
  options[0].practiceCopy.workspace.proposals[0].name = "Only draft";
  options[0].practiceCopy.context.clinicians[0].sessionRate = 999;
  assert.equal(options[1].practiceCopy.context.clinicians[0].sessionRate, 120);
  assert.equal(options[1].practiceCopy.workspace.proposals[0].name, "Legacy goal");
  assert.deepEqual(source, before);
  const saved = makePlanningScenario(options[2].name, options[2].practiceCopy, 8, "today");
  assert.equal(readPracticeGoal(saved)!.workspace.settings.defaultInPersonPct, options[2].practiceCopy.workspace.settings.defaultInPersonPct);
  assert.deepEqual(source.workspace.proposals, before.workspace.proposals);
});

test("empty or explicitly unknown inputs still return three editable focuses without forecasts", () => {
  const workspace = emptyWorkspace("2026-10-14");
  const options = createFocusedPlanAlternatives(workspace, { clinicians: [], staff: [], sessions: [] }, { profitMonthly: null });
  for (const option of options) {
    assert.equal(option.status, "focus-only");
    assert.equal(option.forecast, null);
    assert.ok(option.unknowns.length);
    assert.ok(Object.values(option.values).every((value) => value === null));
    assert.ok(Object.values(option.deltas).every((value) => value === null));
    assert.match(option.reason, /no forecast has been fabricated/);
  }
  const source = fixture();
  const explicit = createFocusedPlanAlternatives(source.workspace, source.context, { profitMonthly: null, sessionsMonthly: null, inPersonPct: null });
  assert.ok(explicit.every((option) => option.forecast === null));
});

test("explicit zero targets and zero configured capacity are not replaced with defaults", () => {
  const source = fixture();
  const options = createFocusedPlanAlternatives(source.workspace, source.context, { sessionsMonthly: 0, profitMonthly: 0, inPersonPct: 0 });
  const sessions = byId(options, "session-capacity"), profit = byId(options, "profit-goal"), rooms = byId(options, "room-fit");
  assert.equal(sessions.practiceCopy.workspace.settings.baselineWeeklySessions, 0);
  assert.equal(sessions.values.sessions, 0);
  assert.equal(sessions.values.revenue, 0);
  assert.equal(profit.practiceCopy.workspace.settings.baselineWeeklySessions, 0);
  assert.equal(rooms.practiceCopy.workspace.settings.defaultInPersonPct, 0);
  source.context.clinicians[0].sessionsPerWeek = 0;
  source.workspace.settings.baselineWeeklySessions = 0;
  source.workspace.settings.targetProfitMonthly = 0;
  const zero = createFocusedPlanAlternatives(source.workspace, source.context);
  assert.equal(zero[0].status, "modeled");
  assert.equal(zero[0].values.capacity, 0);
  assert.equal(zero[0].values.sessions, 0);
});

test("current annual goal derives a monthly target; conflicting goals stay unknown", () => {
  const source = fixture();
  source.workspace.goals.push(goalSchema.parse({ id: crypto.randomUUID(), name: "Current profit", metric: "profit", amount: 7200, basis: "annual" }));
  let profit = byId(createFocusedPlanAlternatives(source.workspace, source.context), "profit-goal");
  assert.ok(profit.assumptions.some((assumption) => assumption.includes("$600 / month; annual goal divided by 12")));
  source.workspace.goals.push(goalSchema.parse({ id: crypto.randomUUID(), name: "Other profit", metric: "profit", amount: 900 }));
  profit = byId(createFocusedPlanAlternatives(source.workspace, source.context), "profit-goal");
  assert.equal(profit.forecast, null);
  assert.match(profit.unknowns.join(" "), /multiple current profit goals/);
  assert.equal(byId(createFocusedPlanAlternatives(source.workspace, source.context, { profitMonthly: 600 }), "profit-goal").status, "modeled");
});

test("missing historical baseline has unknown deltas; missing cap economics cannot fabricate profit", () => {
  const source = fixture();
  source.workspace.settings.baselineMode = "historical";
  source.workspace.settings.baselineWeeklySessions = null;
  const conditional = createFocusedPlanAlternatives(source.workspace, source.context)[0];
  assert.equal(conditional.status, "modeled");
  assert.ok(Object.values(conditional.deltas).every((value) => value === null));
  assert.match(conditional.unknowns.join(" "), /baseline is unknown/);
  source.context.clinicians[0].capEnabled = true;
  source.context.clinicians[0].capAmount = 50000;
  const missing = createFocusedPlanAlternatives(source.workspace, source.context);
  assert.equal(missing[1].forecast, null);
  assert.equal(missing[1].values.profit, null);
  assert.match(missing[1].unknowns.join(" "), /opening annual cap contribution is unknown/);
});

test("unreachable financial target is bounded and owner clinical pay is never added to owner payroll", () => {
  const source = fixture();
  source.workspace.settings.ownerPayrollMonthly = 400;
  source.workspace.settings.ownerPayrollOverride = true;
  source.workspace.settings.familyW2ClinicianId = 1;
  const options = createFocusedPlanAlternatives(source.workspace, source.context, { profitMonthly: 100000 });
  const profit = byId(options, "profit-goal"), sessions = byId(options, "session-capacity");
  assert.match(profit.assumptions.join(" "), /goal is not met/);
  assert.equal(profit.practiceCopy.workspace.settings.baselineWeeklySessions, sessions.practiceCopy.workspace.settings.baselineWeeklySessions);
  for (const option of options) {
    assert.equal(option.practiceCopy.workspace.settings.ownerPayrollMonthly, 400);
    assert.equal(option.practiceCopy.workspace.settings.includeOwnerClinical, source.workspace.settings.includeOwnerClinical);
    assert.deepEqual(option.practiceCopy.context.clinicians, source.context.clinicians);
  }
});

test("unverified in-person room capacity stays unknown rather than assuming unlimited rooms", () => {
  const source = fixture();
  source.workspace.rooms = [];
  const options = createFocusedPlanAlternatives(source.workspace, source.context);
  for (const option of options) {
    assert.equal(option.forecast, null);
    assert.equal(option.values.sessions, null);
    assert.ok(option.unknowns.length);
  }
  assert.match(options[0].unknowns.join(" "), /in-person capacity is unverified/);
});

test("generation is deterministic and works with frozen inputs without changing saved-plan order", () => {
  const source = fixture();
  const freeze = (value: unknown) => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(source);
  const first = createFocusedPlanAlternatives(source.workspace, source.context);
  const second = createFocusedPlanAlternatives(source.workspace, source.context);
  assert.deepEqual(first, second);
  assert.deepEqual(first[0].practiceCopy.workspace.proposals.map((plan) => plan.id), source.workspace.proposals.map((plan) => plan.id));
});

test("display assumptions use at most two decimals and currency while raw modeled values retain precision", () => {
  const source = fixture();
  const options = createFocusedPlanAlternatives(source.workspace, source.context, { profitMonthly: 600.12345 });
  for (const option of options) {
    assert.doesNotMatch(option.assumptions.join(" "), /\d+\.\d{3,}/);
  }
  assert.match(byId(options, "profit-goal").assumptions.join(" "), /\$600\.12/);
  const raw = forecast(source.workspace, source.context, [], 1, false)[0].values.capacity! / (30 / 7);
  assert.equal(byId(options, "session-capacity").practiceCopy.workspace.settings.baselineWeeklySessions, raw);
  assert.notEqual(raw, Number(raw.toFixed(2)));
});

test("generated practice copies validate and round-trip through existing user-initiated saving", () => {
  const source = fixture();
  source.context.sessions.push({
    id: 10, clinicianId: 1, start: "2026-10-01", end: "2026-10-14", completed: 10,
    desired: 20, cancelled: null, noShow: null, scheduled: null, inPerson: null,
    telehealth: null, sourceAttachmentId: null, revision: 1, updatedAt: "2026-10-14T12:00:00Z",
  });
  const before = structuredClone(source);
  for (const option of createFocusedPlanAlternatives(source.workspace, source.context)) {
    const valid = validatePracticeCopy(option.practiceCopy);
    assert.equal(valid.context.sessions[0].id, 10);
    assert.deepEqual(valid.workspace.proposals, source.workspace.proposals);
    const saved = makePlanningScenario(option.name, valid, 9, "today");
    const restored = readPracticeGoal(saved)!;
    assert.equal(restored.workspace.settings.baselineWeeklySessions, option.practiceCopy.workspace.settings.baselineWeeklySessions);
    assert.equal(saved.approvedAt, null);
  }
  assert.deepEqual(source, before);
});

test("priority exposes defined first-month targets and unweighted fractional shortfalls", () => {
  const source = fixture();
  const base = forecast(source.workspace, source.context, [], 1, false)[0];
  const options = createFocusedPlanAlternatives(source.workspace, source.context);
  const sessions = byId(options, "session-capacity"), profit = byId(options, "profit-goal"), rooms = byId(options, "room-fit");
  assert.equal(sessions.priority.metric, "sessions");
  assert.equal(sessions.priority.base, base.values.sessions);
  assert.equal(sessions.priority.target, base.values.capacity);
  assert.equal(sessions.priority.shortfall, base.values.capacity! - base.values.sessions!);
  assert.equal(sessions.priority.relativeGap, sessions.priority.shortfall! / sessions.priority.target!);
  assert.equal(profit.priority.metric, "profit");
  assert.equal(profit.priority.target, 600);
  assert.equal(profit.priority.base, base.values.profit);
  assert.equal(profit.priority.shortfall, 0);
  assert.equal(profit.priority.relativeGap, 0);
  assert.equal(rooms.priority.metric, "roomDemandCoverage");
  assert.equal(rooms.priority.target, Math.min(base.values.sessions! + base.values.unservedSessions!, base.values.capacity!));
  assert.equal(rooms.priority.shortfall, 0);
  assert.equal(sessions.rank, 1);
  assert.equal(profit.rank, rooms.rank, "Equal evidenced gaps have equal rank, not an implied ordering");
  for (const option of options) assert.equal(option.priority.period, base.date);
});

test("a larger evidenced profit goal gap moves profit ahead of session capacity", () => {
  const source = fixture();
  const first = createFocusedPlanAlternatives(source.workspace, source.context);
  assert.equal(first[0].id, "session-capacity");
  source.workspace.settings.targetProfitMonthly = 100000;
  const before = structuredClone(source);
  const largerGoal = createFocusedPlanAlternatives(source.workspace, source.context);
  assert.equal(largerGoal[0].id, "profit-goal");
  assert.equal(largerGoal[0].rank, 1);
  assert.ok(largerGoal[0].priority.relativeGap! > byId(largerGoal, "session-capacity").priority.relativeGap!);
  assert.deepEqual(source, before);
});

test("changing configured session capacity changes its fractional gap and ranking", () => {
  const source = fixture();
  source.workspace.settings.baselineWeeklySessions = 16;
  source.workspace.settings.targetProfitMonthly = 6000;
  source.workspace.rooms[0].weeklyHours = 100;
  const first = createFocusedPlanAlternatives(source.workspace, source.context);
  assert.equal(first[0].id, "profit-goal");
  source.context.clinicians[0].sessionsPerWeek = 40;
  const moreCapacity = createFocusedPlanAlternatives(source.workspace, source.context);
  assert.equal(moreCapacity[0].id, "session-capacity");
  assert.ok(moreCapacity[0].priority.relativeGap! > byId(first, "session-capacity").priority.relativeGap!);
  assert.equal(byId(moreCapacity, "profit-goal").priority.base, byId(first, "profit-goal").priority.base);
});

test("binding room priority is bounded by clinically attainable demand, excluding demand above clinician capacity", () => {
  const source = fixture();
  source.workspace.settings.baselineWeeklySessions = 40;
  source.workspace.settings.targetProfitMonthly = 4000;
  source.workspace.rooms[0].weeklyHours = 100;
  const ampleRooms = createFocusedPlanAlternatives(source.workspace, source.context);
  const ampleBase = forecast(source.workspace, source.context, [], 1, false)[0];
  assert.equal(ampleBase.constraint, "Clinician capacity");
  assert.ok(ampleBase.values.unservedSessions! > 0);
  assert.equal(byId(ampleRooms, "room-fit").priority.shortfall, 0);
  assert.equal(ampleRooms[0].id, "profit-goal");
  source.workspace.rooms[0].weeklyHours = 8;
  const constrainedBase = forecast(source.workspace, source.context, [], 1, false)[0];
  assert.equal(constrainedBase.constraint, "Room capacity");
  const totalDemand = constrainedBase.values.sessions! + constrainedBase.values.unservedSessions!;
  const clinicianCapacity = constrainedBase.values.capacity!;
  const delivered = constrainedBase.values.sessions!;
  assert.equal(totalDemand.toFixed(2), "171.43");
  assert.equal(clinicianCapacity.toFixed(2), "78.85");
  assert.equal(delivered.toFixed(2), "34.29");
  assert.ok(totalDemand > clinicianCapacity, "The excess demand is not clinically attainable even if room limits were removed");
  const constrained = createFocusedPlanAlternatives(source.workspace, source.context);
  const roomPriority = byId(constrained, "room-fit").priority;
  const sessionOption = byId(constrained, "session-capacity");
  assert.equal(roomPriority.base, delivered);
  assert.equal(roomPriority.target, clinicianCapacity);
  assert.equal(roomPriority.shortfall, clinicianCapacity - delivered);
  assert.ok(roomPriority.shortfall! < constrainedBase.values.unservedSessions!, "Do not attribute all 137.14 unserved sessions to rooms");
  assert.equal(roomPriority.relativeGap, (clinicianCapacity - delivered) / clinicianCapacity);
  assert.ok(roomPriority.relativeGap! < 0.6, "The bounded room gap must not retain the former 80% all-demand gap");
  assert.match(roomPriority.basis, /min\(total current demand, configured clinician capacity\)/);
  assert.match(roomPriority.basis, /upper bound.*not an exact recovery forecast/);
  assert.equal(constrained[0].id, "profit-goal", "The evidenced profit gap exceeds the corrected bounded room gap");
  assert.equal(byId(constrained, "room-fit").rank, 2);
  assert.equal(byId(constrained, "room-fit").rank, sessionOption.rank, "Identical attainable-session gaps share rank without an invented room weighting");
  for (const option of constrained) {
    assert.deepEqual(option.forecast, forecast(option.practiceCopy.workspace, option.practiceCopy.context, [], 1, false));
  }
});

test("room priority uses demand itself when it is below configured clinician capacity", () => {
  const source = fixture();
  source.workspace.settings.baselineWeeklySessions = 12;
  const baseline = forecast(source.workspace, source.context, [], 1, false)[0];
  const demand = baseline.values.sessions! + baseline.values.unservedSessions!;
  assert.equal(baseline.constraint, "Room capacity");
  assert.ok(demand < baseline.values.capacity!);
  const before = structuredClone(source);
  const room = byId(createFocusedPlanAlternatives(source.workspace, source.context), "room-fit");
  assert.equal(room.priority.target, demand);
  assert.equal(room.priority.shortfall, demand - baseline.values.sessions!);
  assert.equal(room.priority.relativeGap, (demand - baseline.values.sessions!) / demand);
  assert.deepEqual(source, before);
});

test("unknown baselines, unknown goals, and zero denominators never fabricate relative gaps or ranks", () => {
  const source = fixture();
  const unknownGoal = byId(createFocusedPlanAlternatives(source.workspace, source.context, { profitMonthly: null }), "profit-goal");
  assert.equal(unknownGoal.priority.target, null);
  assert.equal(unknownGoal.priority.shortfall, null);
  assert.equal(unknownGoal.priority.relativeGap, null);
  assert.equal(unknownGoal.rank, null);
  const zeroGoal = byId(createFocusedPlanAlternatives(source.workspace, source.context, { profitMonthly: 0 }), "profit-goal");
  assert.equal(zeroGoal.priority.target, 0);
  assert.equal(zeroGoal.priority.shortfall, 0);
  assert.equal(zeroGoal.priority.relativeGap, null);
  assert.equal(zeroGoal.rank, null);
  source.workspace.settings.baselineMode = "historical";
  source.workspace.settings.baselineWeeklySessions = null;
  const unknownBaseline = createFocusedPlanAlternatives(source.workspace, source.context);
  assert.ok(unknownBaseline.some((option) => option.status === "modeled"));
  for (const option of unknownBaseline) {
    assert.equal(option.priority.base, null);
    assert.equal(option.priority.shortfall, null);
    assert.equal(option.priority.relativeGap, null);
    assert.equal(option.rank, null);
  }
});

test("ranking places eligible options first and preserves tied and unknown order without mutating inputs", () => {
  const source = fixture();
  const options = createFocusedPlanAlternatives(source.workspace, source.context);
  const input = [byId(options, "room-fit"), byId(options, "profit-goal"), byId(options, "session-capacity")];
  for (const option of input) option.priority = { ...option.priority, base: 50, target: 100, shortfall: 50, relativeGap: 0.5 };
  const before = structuredClone(input), sourceBefore = structuredClone(source);
  const tie = rankFocusedPlanAlternatives(input);
  assert.deepEqual(tie.map((option) => option.id), input.map((option) => option.id));
  assert.deepEqual(tie.map((option) => option.rank), [1, 1, 1]);
  assert.deepEqual(input, before);
  tie[0].practiceCopy.workspace.proposals[0].name = "Only sorted copy";
  assert.deepEqual(input, before);
  assert.deepEqual(source, sourceBefore);
  input[0].status = "focus-only";
  input[0].forecast = null;
  const partial = rankFocusedPlanAlternatives(input);
  assert.deepEqual(partial.map((option) => option.id), ["profit-goal", "session-capacity", "room-fit"]);
  assert.deepEqual(partial.map((option) => option.rank), [1, 1, null]);
  input[1].priority.target = null;
  const staleMetadata = rankFocusedPlanAlternatives(input);
  assert.deepEqual(staleMetadata.map((option) => option.id), ["session-capacity", "room-fit", "profit-goal"]);
  assert.deepEqual(staleMetadata.map((option) => option.rank), [1, null, null]);
});

test("negative modeled profit can expose a gap above 100 percent without clipping or changing forecasts", () => {
  const source = fixture();
  source.workspace.settings.ownerPayrollOverride = true;
  source.workspace.settings.ownerPayrollMonthly = 2000;
  const options = createFocusedPlanAlternatives(source.workspace, source.context);
  const profit = byId(options, "profit-goal");
  assert.ok(profit.priority.base! < 0);
  assert.ok(profit.priority.relativeGap! > 1);
  assert.equal(options[0].id, "profit-goal");
  for (const option of rankFocusedPlanAlternatives(options)) {
    const original = byId(options, option.id);
    assert.deepEqual(option.forecast, original.forecast);
    assert.deepEqual(option.values, original.values);
    assert.deepEqual(option.deltas, original.deltas);
    assert.deepEqual(option.practiceCopy, original.practiceCopy);
    assert.equal(option.assumptionSignature, original.assumptionSignature);
  }
});
