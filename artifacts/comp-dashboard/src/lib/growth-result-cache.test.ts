import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGrowthResultCache,
  growthViewSettings,
  type GrowthSourceInput,
} from "./growth-result-cache.ts";
import { reviewedGrowthFromSources } from "./reviewed-growth-source.ts";
import { DEFAULT_GROWTH_SETTINGS } from "./reviewed-growth-observations.ts";
import { emptyWorkspace } from "@workspace/practice/hub";
const input = () =>
  ({
    workspace: emptyWorkspace("2026-10-27"),
    context: { clinicians: [], staff: [], sessions: [] },
    snapshots: [],
    overrides: {},
    today: "2026-10-27",
    settings: { ...DEFAULT_GROWTH_SETTINGS },
    scenario: false,
  }) as GrowthSourceInput;
test("cache reuses exact source bundle, invalidates every input family, never mutates or persists data", () => {
  let calls = 0;
  const cache = createGrowthResultCache((a) => {
    calls++;
    return reviewedGrowthFromSources(a);
  });
  const a = input(),
    before = JSON.stringify(a),
    result = cache.calculate(a);
  assert.equal(cache.calculate(structuredClone(a)), result);
  assert.equal(calls, 1);
  const changes: ((a: GrowthSourceInput) => void)[] = [
    (a) => {
      a.today = "2026-10-28";
    },
    (a) => {
      a.settings.occupancy = 0.7;
    },
    (a) => {
      a.settings.goalMonths = 5;
    },
    (a) => {
      a.workspace.settings.weeksPerYear = 47;
    },
    (a) => {
      a.context = { ...a.context, staff: [{ id: 123 } as never] };
    },
    (a) => {
      a.overrides = { synthetic: 2 };
    },
    (a) => {
      a.declarations = { mappings: [] } as never;
    },
    (a) => {
      a.scenario = true;
    },
    (a) => {
      a.planningWorkspace = structuredClone(a.workspace);
    },
    (a) => {
      a.planningContext = structuredClone(a.context);
    },
  ];
  for (const mutate of changes) {
    const next = input();
    mutate(next);
    const count = calls;
    cache.calculate(next);
    assert.equal(calls, count + 1);
  }
  assert.equal(JSON.stringify(a), before);
});
test("cache includes retained snapshot evidence and roster changes even when numerical result is unchanged", () => {
  let calls = 0;
  const cache = createGrowthResultCache((a) => {
    calls++;
    return {
      version: "test",
      cutoff: null,
      stock: null,
      actualMonths: [],
      families: [],
      reason: null,
      providers: { rows: [], allocation: [], cutoff: null },
      staffingCandidates: { overlays: [], issues: [], templateCount: 0 },
      inputRevision: JSON.stringify(a),
    } as ReturnType<typeof reviewedGrowthFromSources>;
  });
  const a = input();
  cache.calculate(a);
  a.snapshots = [{ id: "synthetic", rows: [] } as never];
  cache.calculate(a);
  a.context.clinicians = [{ id: 1, sessionsPerWeek: 20 } as never];
  cache.calculate(a);
  a.context.clinicians[0].sessionsPerWeek = 30;
  cache.calculate(a);
  assert.equal(calls, 4);
});

test("view policy fixes five-day consult delay and zero reserve without changing saved plans", () => {
  const saved = {
    ...DEFAULT_GROWTH_SETTINGS,
    leadConsultDays: 12,
    reserve: 9,
    checkMonths: 2,
    goalMonths: 8,
    providerPlans: {
      "1": {
        usePracticeProxy: true,
        monthlyLeads: { "2026-10": 15 },
        reserve: 7,
      },
    },
  };
  const before = JSON.stringify(saved),
    view = growthViewSettings(saved);
  assert.equal(view.leadConsultDays, 5);
  assert.equal(view.reserve, 0);
  assert.equal(view.providerPlans["1"].reserve, 0);
  assert.equal(view.checkMonths, 8);
  assert.equal(view.otherRouteDays, saved.otherRouteDays);
  assert.equal(view.providerPlans["1"].monthlyLeads["2026-10"], 15);
  assert.equal(JSON.stringify(saved), before);
});
