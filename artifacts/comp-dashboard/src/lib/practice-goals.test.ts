import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace,
  proposalSchema,
  campaignSchema,
  budgetSchema,
  categorySchema,
  type Context,
  forecast,
} from "@workspace/practice/hub";
import {
  copyPractice,
  makePracticeGoal,
  readPracticeGoal,
  practiceChanges,
} from "./practice-goals.ts";

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
