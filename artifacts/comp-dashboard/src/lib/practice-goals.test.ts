import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace,
  proposalSchema,
  campaignSchema,
  budgetSchema,
  categorySchema,
  periodSchema,
  type Context,
  forecast,
} from "@workspace/practice/hub";
import {
  copyPractice,
  makePracticeGoal,
  makePlanningScenario,
  makeSandboxModel,
  blankPractice,
  readPracticeGoal,
  practiceChanges,
} from "./practice-goals.ts";
import { exportSection, importSection } from "./section-transfer.ts";

function fixture() {
  const workspace = emptyWorkspace("2026-09-20");
  const context: Context = {
    clinicians: [
      {
        id: 1,
        label: "Test clinician",
        goalId: null,
        sessionRate: 125,
        sessionsPerWeek: 20,
        weeksWorkedPerYear: 48,
        classification: "w2",
        capEnabled: false,
        capAmount: 50000,
        preCapClinicianSplit: 60,
        preCapPracticeSplit: 40,
        postCapClinicianSplit: 75,
        postCapPracticeSplit: 25,
        w2EmployerFicaPct: 7.65,
        futaSutaPct: 1,
        workersCompPct: 0.5,
        otherEmployerBurdenPct: 0,
      },
    ],
    staff: [],
    sessions: [],
  };
  const category = categorySchema.parse({
    id: crypto.randomUUID(),
    name: "Flexible overhead",
    kind: "expense",
  });
  workspace.categories.push(category);
  workspace.budgets.push(
    budgetSchema.parse({
      id: crypto.randomUUID(),
      name: "Rent",
      categoryId: category.id,
      amount: 1000,
      cadence: "monthly",
      start: "2026-09-01",
    }),
  );
  workspace.campaigns.push(
    campaignSchema.parse({
      id: crypto.randomUUID(),
      name: "Search",
      source: "Search",
      method: "cpl",
      monthlySpend: 500,
      start: "2026-09-01",
    }),
  );
  return { workspace, context };
}
test("sandbox layers multiple changes without mutating practice", () => {
  const practice = fixture(),
    before = structuredClone(practice);
  const draft = copyPractice(practice.workspace, practice.context);
  draft.context.clinicians[0].sessionRate = 160;
  draft.workspace.budgets[0].amount = 1400;
  draft.workspace.campaigns[0].monthlySpend = 1200;
  assert.deepEqual(practice, before);
  assert.equal(practiceChanges(practice, draft).length, 3);
  const goal = makePracticeGoal("Layered expansion", draft, 12);
  assert.equal(goal.approvedAt, null);
  assert.deepEqual(goal.approvedIds, []);
  assert.deepEqual(goal.changes, []);
  assert.equal(goal.status, "draft");
  const restored = readPracticeGoal(goal)!;
  assert.equal(restored.context.clinicians[0].sessionRate, 160);
  assert.equal(restored.workspace.budgets[0].amount, 1400);
  assert.equal(restored.workspace.campaigns[0].monthlySpend, 1200);
  assert.deepEqual(practice, before);
  assert.deepEqual(
    forecast(restored.workspace, restored.context),
    forecast(draft.workspace, draft.context),
  );
});
test("saved goals are isolated, nonrecursive and exclude access tokens", () => {
  const practice = fixture();
  Object.assign(practice.context.clinicians[0], {
    shareToken: "must-not-copy",
    createdAt: "ignored",
  });
  const first = makePracticeGoal("First", practice, 1);
  practice.workspace.proposals.push(first);
  const second = makePracticeGoal("Second", practice, 2);
  const restored = readPracticeGoal(second)!;
  assert.equal(restored.workspace.proposals.length, 0);
  assert.equal("shareToken" in restored.context.clinicians[0], false);
  restored.context.clinicians[0].sessionRate = 999;
  assert.equal(
    readPracticeGoal(second)!.context.clinicians[0].sessionRate,
    125,
  );
  assert.equal(readPracticeGoal(first)!.context.clinicians[0].sessionRate, 125);
});
test("legacy proposals are preserved and malformed goals do not load", () => {
  const legacy = proposalSchema.parse({
    id: crypto.randomUUID(),
    name: "Old proposal",
    baseline: { before: [], after: [] },
  });
  assert.equal(readPracticeGoal(legacy), null);
  assert.equal(
    readPracticeGoal({ ...legacy, baseline: { kind: "practice-goal-v1" } }),
    null,
  );
  assert.throws(() => makePracticeGoal(" ", fixture(), 1));
});
test("each goal retains its own team and time horizon", () => {
  const a = fixture(),
    b = fixture();
  a.workspace.settings.horizonMonths = 6;
  b.workspace.settings.horizonMonths = 36;
  b.workspace.settings.teamId = 8;
  const short = readPracticeGoal(makePracticeGoal("Short", a, 1))!;
  const long = readPracticeGoal(makePracticeGoal("Long", b, 1))!;
  assert.equal(short.workspace.settings.horizonMonths, 6);
  assert.equal(short.workspace.settings.teamId, null);
  assert.equal(long.workspace.settings.horizonMonths, 36);
  assert.equal(long.workspace.settings.teamId, 8);
});
test("planning scenarios are independent editable snapshots", () => {
  const today = fixture();
  today.context.staff.push({
    id: 7,
    label: "Practice manager",
    goalId: null,
    annualSalary: 60000,
    hourlyRate: null,
    hoursPerWeek: null,
    weeksPerYear: 48,
    classification: "w2",
    w2EmployerFicaPct: 7.65,
    futaSutaPct: 1,
    workersCompPct: 0.5,
    otherEmployerBurdenPct: 0,
  });
  const first = makePlanningScenario("Year 1", today, 5, "today");
  const revised = structuredClone(today);
  revised.context.clinicians[0].sessionsPerWeek = 30;
  const yearOne = makePlanningScenario("Year 1", revised, 5, "today", first);
  const yearThree = makePlanningScenario("Year 3", today, 5, "today");
  assert.equal(yearOne.id, first.id);
  assert.equal(
    readPracticeGoal(yearOne)?.context.clinicians[0].sessionsPerWeek,
    30,
  );
  assert.equal(
    readPracticeGoal(yearOne)?.context.staff[0].label,
    "Practice manager",
  );
  assert.equal(
    readPracticeGoal(yearThree)?.context.clinicians[0].sessionsPerWeek,
    20,
  );
  assert.equal(today.context.clinicians[0].sessionsPerWeek, 20);
});
test("new clinicians and staff count as unsaved modeled edits", () => {
  const start = blankPractice("2026-09-20");
  const changed = structuredClone(start);
  changed.context.clinicians.push(fixture().context.clinicians[0]);
  changed.context.staff.push({
    id: 1,
    label: "Administrator",
    annualSalary: 50000,
    weeksPerYear: 48,
    classification: "w2",
    w2EmployerFicaPct: 7.65,
    futaSutaPct: 1,
    workersCompPct: 0.5,
    otherEmployerBurdenPct: 0,
  });
  assert.equal(practiceChanges(start, changed).length, 2);
  assert.equal(practiceChanges(changed, start).length, 2);
});
test("blank Sandbox has no real clinicians or expenses", () => {
  const today = fixture();
  const blank = blankPractice("2026-09-20");
  assert.equal(blank.context.clinicians.length, 0);
  assert.equal(blank.workspace.budgets.length, 0);
  assert.equal(blank.workspace.campaigns.length, 0);
  assert.equal(blank.workspace.settings.baselineWeeklySessions, 0);
  assert.equal(blank.workspace.settings.forecastStart, "2026-10-01");
  assert.equal(today.workspace.budgets.length, 1);
});
test("Sandbox models save independently from Planning scenarios", () => {
  const blank = blankPractice("2026-09-20");
  const model = makeSandboxModel("New business", blank, 3);
  assert.equal(model.baseline?.kind, "sandbox-model-v1");
  assert.equal(
    readPracticeGoal(model)?.workspace.settings.practiceName,
    "New business",
  );
  const updated = structuredClone(blank);
  updated.workspace.settings.practiceName = "New location";
  const savedAgain = makeSandboxModel("New business", updated, 3, model);
  assert.equal(savedAgain.id, model.id);
  assert.equal(
    readPracticeGoal(savedAgain)?.workspace.settings.practiceName,
    "New location",
  );
  assert.equal(model.baseline?.kind, "sandbox-model-v1");
});
test("section transfer replaces only its section and protects Today history", () => {
  const source = fixture();
  const target = fixture();
  source.workspace.settings.overheadFloorOverride = true;
  source.workspace.settings.overheadFloorMonthly = 4000;
  source.workspace.settings.ownerPayrollOverride = true;
  target.workspace.budgets[0].amount = 400;
  target.workspace.campaigns[0].monthlySpend = 1200;
  const budget = exportSection(source, "budgets", "planning");
  assert.equal("campaigns" in budget.workspace, false);
  const result = importSection(target, budget, "today");
  assert.equal(result.workspace.budgets[0].amount, 1000);
  assert.equal(result.workspace.settings.overheadFloorOverride, true);
  assert.equal(result.workspace.settings.overheadFloorMonthly, 4000);
  assert.equal(result.workspace.campaigns[0].monthlySpend, 1200);
  assert.equal(target.workspace.budgets[0].amount, 400);
  assert.throws(() =>
    importSection(
      target,
      exportSection(source, "sessions", "planning"),
      "today",
    ),
  );
  assert.throws(() =>
    importSection(
      target,
      exportSection(source, "clinicians", "planning"),
      "today",
    ),
  );
  const oldPeriod = periodSchema.parse({
    id: crypto.randomUUID(),
    name: "Old",
    start: "2026-08-01",
    end: "2026-08-31",
  });
  const newPeriod = periodSchema.parse({
    id: crypto.randomUUID(),
    name: "New",
    start: "2026-09-01",
    end: "2026-09-30",
  });
  target.workspace.periods = [oldPeriod];
  source.workspace.periods = [newPeriod];
  source.workspace.settings.familyW2ClinicianId = 1;
  target.workspace.settings.familyW2ClinicianId = 1;
  const oldPaycheck = { id: crypto.randomUUID(), clinicianId: 1, date: "2026-08-15", netAmount: 1800 };
  const newPaycheck = { id: crypto.randomUUID(), clinicianId: 1, date: "2026-09-15", netAmount: 2000 };
  target.workspace.familyPaychecks = [oldPaycheck];
  source.workspace.familyPaychecks = [newPaycheck];
  const money = exportSection(source, "money", "planning");
  assert.equal(importSection(target, money, "sandbox").workspace.settings.ownerPayrollOverride, true);
  assert.deepEqual(importSection(target, money, "today").workspace.periods, [
    oldPeriod,
  ]);
  assert.deepEqual(importSection(target, money, "today").workspace.familyPaychecks, [oldPaycheck]);
  assert.deepEqual(importSection(target, money, "sandbox").workspace.periods, [
    newPeriod,
  ]);
  assert.deepEqual(importSection(target, money, "sandbox").workspace.familyPaychecks, [newPaycheck]);
});
test("each section can move into a blank modeled business", () => {
  const source = fixture();
  for (const section of [
    "clinicians",
    "sessions",
    "marketing",
    "rooms",
    "budgets",
    "money",
  ] as const) {
    const result = importSection(
      blankPractice("2026-09-20"),
      exportSection(source, section, "today"),
      "sandbox",
    );
    assert.equal(result.workspace.proposals.length, 0);
  }
  const team = importSection(
    blankPractice("2026-09-20"),
    exportSection(source, "clinicians", "today"),
    "sandbox",
  );
  assert.equal(team.context.clinicians[0].sessionsPerWeek, 20);
  assert.equal(team.workspace.settings.baselineWeeklySessions, 20);
});
test("clinician import does not silently reassign modeled session history", () => {
  const target = fixture();
  target.context.sessions.push({
    id: 11,
    revision: 1,
    updatedAt: "2026-09-15T12:00:00Z",
    clinicianId: 1,
    start: "2026-09-01",
    end: "2026-09-14",
    completed: 8,
    desired: 40,
    cancelled: null,
    noShow: null,
    scheduled: null,
    inPerson: null,
    telehealth: null,
    sourceAttachmentId: null,
  });
  const source = fixture();
  source.context.clinicians[0].label = "Different clinician";
  assert.throws(
    () =>
      importSection(
        target,
        exportSection(source, "clinicians", "sandbox"),
        "planning",
      ),
    /history belongs/,
  );
  assert.throws(
    () =>
      importSection(
        blankPractice("2026-09-20"),
        exportSection(target, "sessions", "today"),
        "sandbox",
      ),
    /same clinicians/,
  );
});
