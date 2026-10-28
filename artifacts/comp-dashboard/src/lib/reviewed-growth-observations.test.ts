import { test } from "node:test";
import assert from "node:assert/strict";
import type { Workspace } from "@workspace/practice/hub";
import {
  reviewedGrowth,
  DEFAULT_GROWTH_SETTINGS,
  type GrowthObservationInput,
} from "./reviewed-growth-observations.ts";
const visit = (clientId: string, date: string, clinicianId = 1) => ({
  clientId,
  date,
  clinicianId,
});
function input(): GrowthObservationInput {
  const periods = Array.from({ length: 9 }, (_, i) => ({
    id: `m${i + 1}`,
    start: `2026-${String(i + 1).padStart(2, "0")}-01`,
    end: new Date(Date.UTC(2026, i + 1, 0)).toISOString().slice(0, 10),
    archived: false,
    funnelComplete: i !== 8,
  }));
  const funnels = periods.map((p) => ({
    periodId: p.id,
    scope: "practice",
    clinicianId: null,
    leads: 10,
    clients: 2,
    campaignId: null,
    sourceName: "",
  }));
  return {
    today: "2026-10-27",
    workspace: { periods, funnels } as Pick<Workspace, "periods" | "funnels">,
    visits: [
      visit("a", "2026-01-02"),
      visit("a", "2026-03-02"),
      visit("a", "2026-05-02"),
      visit("a", "2026-09-15"),
      visit("b", "2026-07-01"),
      visit("b", "2026-07-08"),
      visit("b", "2026-07-15"),
      visit("early", "2026-09-20"),
      visit("future", "2026-10-02"),
    ],
    consults: [visit("a", "2025-12-20"), visit("b", "2026-06-25")],
    coverage: [{ clinicianId: 1, start: "2025-01-01", end: "2026-10-21" }],
    clinicianIds: [1],
    weeklyCapacity: 94,
    weeksPerYear: 48,
    settings: { ...DEFAULT_GROWTH_SETTINGS },
    scenario: false,
  };
}
test("common completed cutoff excludes future qualification and counts all-time third dates despite early gaps", () => {
  const a = input(),
    r = reviewedGrowth(a);
  assert.equal(r.cutoff, "2026-09-30");
  assert.deepEqual(r.stock, { established: 2, early: 1 });
  const before = JSON.stringify(r);
  a.visits.push(visit("early", "2026-10-01"), visit("early", "2026-10-02"));
  assert.equal(JSON.stringify(reviewedGrowth(a)), before);
  assert.equal(r.families[0]!.provisional, true);
  assert.equal(r.families[1]!.leadMonths.length, 9);
  assert.equal(r.families[0]!.latestCompleteLeadMonth, "2026-08");
});
test("exact 90 day expiry, reactivation, and no future qualification", () => {
  const a = input();
  a.visits = [
    visit("x", "2026-01-01"),
    visit("x", "2026-02-01"),
    visit("x", "2026-07-02"),
  ];
  assert.equal(reviewedGrowth(a).stock!.established, 0);
  a.visits.push(visit("x", "2026-09-30"));
  assert.equal(reviewedGrowth(a).stock!.established, 1);
  a.visits = [
    visit("x", "2026-09-01"),
    visit("x", "2026-09-01"),
    visit("x", "2026-09-15"),
    visit("x", "2026-10-01"),
  ];
  assert.equal(reviewedGrowth(a).stock!.early, 1);
});
test("practice unique qualification spans clinicians; transfers do not create new starts", () => {
  const a = input();
  a.clinicianIds = [1, 2];
  a.coverage.push({ clinicianId: 2, start: "2025-01-01", end: "2026-10-21" });
  a.visits = [
    visit("x", "2026-01-01"),
    visit("x", "2026-04-01", 2),
    visit("x", "2026-09-15", 2),
  ];
  const r = reviewedGrowth(a);
  assert.equal(r.stock!.established, 1);
  assert.equal(r.families[0]!.starts, 0);
  assert.equal(r.families[1]!.starts, 1);
});
test("unknown coverage is not zero, and fully observed zero age intervals remain zero", () => {
  const a = input();
  a.coverage = [];
  assert.equal(reviewedGrowth(a).cutoff, null);
  const b = input();
  const r = reviewedGrowth(b);
  assert.ok(r.families[0]!.response);
  assert.ok(r.families[0]!.fallbackAges.includes(90));
});
test("capacity, horizon, intake and source changes recompute without mutating historical facts", () => {
  const a = input(),
    serialized = JSON.stringify(a),
    base = reviewedGrowth(a);
  const changed = reviewedGrowth({ ...a, weeklyCapacity: 70 });
  assert.notDeepEqual(
    changed.families[0]!.capacity,
    base.families[0]!.capacity,
  );
  assert.equal(
    changed.families[0]!.establishedDays,
    base.families[0]!.establishedDays,
  );
  const override = {
    ...a.settings,
    monthlyLeads: { "2026-10": 100 },
    staffing: [
      {
        id: "hypothesis",
        startMonth: "2026-11",
        weeklyCapacity: 20,
        rampMonths: 2,
      },
    ],
  };
  assert.deepEqual(
    reviewedGrowth({ ...a, settings: override }).families[0]!.projection,
    base.families[0]!.projection,
  );
  const sandbox = reviewedGrowth({ ...a, settings: override, scenario: true });
  assert.equal(sandbox.families[0]!.leadSeries![0], 100);
  assert.equal(sandbox.families[0]!.capacity![1], 416);
  assert.equal(JSON.stringify(a), serialized);
});
test("missing lead months excluded rather than zero filled; duplicates rejected", () => {
  const a = input();
  a.workspace.periods = a.workspace.periods.filter((p) => p.id !== "m8");
  assert.equal(reviewedGrowth(a).families[0]!.leadMonths.length, 2);
  a.workspace.funnels.push({ ...a.workspace.funnels[0]! });
  assert.equal(
    reviewedGrowth(a).families[1]!.leadMonths.includes("2026-01"),
    false,
  );
});
test("shared-provider first/latest dates count practice unique once and are order independent", () => {
  const a = input();
  a.clinicianIds = [1, 2];
  a.coverage.push({ clinicianId: 2, start: "2025-01-01", end: "2026-10-21" });
  a.visits = [
    visit("shared", "2026-07-01", 1),
    visit("shared", "2026-07-01", 2),
    visit("shared", "2026-07-08", 1),
    visit("shared", "2026-09-20", 1),
    visit("shared", "2026-09-20", 2),
  ];
  const first = reviewedGrowth(a);
  assert.equal(first.stock!.established, 1);
  assert.equal(first.families[0]!.starts, 1);
  assert.deepEqual(
    reviewedGrowth({ ...a, visits: [...a.visits].reverse() }),
    first,
  );
});
test("positive leads with no observed starts give a zero response, not a fabricated conversion", () => {
  const a = input();
  a.visits = [];
  const result = reviewedGrowth(a);
  assert.equal(result.families[0]!.response!.cumulative[0], 0);
  assert.equal(result.families[0]!.projection!.goalStatus, "unattainable");
});
test("excluded follow-up and missing lookback coverage cannot silently classify inactivity", () => {
  const a = input();
  a.excludedTreatmentEvidence = [visit("a", "2026-08-01")];
  assert.match(reviewedGrowth(a).reason!, /Unresolved treatment/);
  const b = input();
  b.coverage = [{ clinicianId: 1, start: "2026-09-01", end: "2026-10-21" }];
  assert.match(reviewedGrowth(b).reason!, /90-day/);
});

test("six harmless boundary clients and one annual qualification dependency preserve current stock and recent forecast", () => {
  const a = input();
  for (let i = 0; i < 7; i++) {
    const id = `boundary-${i}`;
    a.visits.push(...["2025-07-10", i === 6 ? "2025-10-01" : "2025-07-20",
      i === 6 ? "2025-11-05" : "2025-08-01", "2026-09-10"].map(d => visit(id, d)));
  }
  const clean = reviewedGrowth(a);
  a.excludedTreatmentEvidence = Array.from({ length: 7 }, (_, i) => visit(`boundary-${i}`, "2025-07-01"));
  const before = JSON.stringify(a);
  const result = reviewedGrowth(a);
  assert.equal(result.reason, null);
  assert.deepEqual(result.stock, clean.stock);
  assert.deepEqual(result.families[0]!.projection, clean.families[0]!.projection);
  assert.ok(result.families[0]!.projection);
  assert.equal(result.families[1]!.projection, null);
  assert.match(result.families[1]!.reason!, /historical treatment evidence/);
  assert.equal(JSON.stringify(a), before);
  a.excludedTreatmentEvidence.pop();
  assert.deepEqual(reviewedGrowth(a).families.map(f => f.projection), clean.families.map(f => f.projection));
});

test("multiple old excluded dates can establish a current early client and must block stock", () => {
  const a = input();
  a.excludedTreatmentEvidence = [visit("early", "2025-07-01"), visit("early", "2025-07-02")];
  assert.match(reviewedGrowth(a).reason!, /current client status/);
});

test("old first-date uncertainty still blocks response calibration even after qualification predates history", () => {
  const a = input();
  a.excludedTreatmentEvidence = [visit("a", "2025-07-01")];
  const result = reviewedGrowth(a);
  assert.equal(result.reason, null);
  assert.equal(result.families[0]!.projection, null); // longer tail uses January starter cohort
  assert.equal(result.families[1]!.projection, null);
});

test("recent missing attendance can affect latest activity and remains blocked even for previously unseen clients", () => {
  const a = input();
  a.excludedTreatmentEvidence = [visit("unadmitted", "2026-09-30")];
  assert.match(reviewedGrowth(a).reason!, /current client status/);
  a.excludedTreatmentEvidence = [visit("unadmitted", "2026-10-01")];
  assert.equal(reviewedGrowth(a).reason, null);
});

test("older excluded follow-up still blocks a borrowed response tail without changing first or third dates", () => {
  const a = input();
  a.visits = ["2026-01-01", "2026-01-08", "2026-01-15", "2026-09-15"].map(d => visit("older", d))
    .concat(["2026-07-01", "2026-07-08", "2026-07-15"].map(d => visit("recent", d)));
  const baseline = reviewedGrowth(a);
  assert.ok(baseline.families[0]!.fallbackAges.includes(90));
  assert.ok(baseline.families[0]!.projection);
  a.excludedTreatmentEvidence = [visit("older", "2026-04-01")];
  const result = reviewedGrowth(a);
  assert.equal(result.reason, null);
  assert.deepEqual(result.stock, baseline.stock);
  assert.equal(result.families[0]!.projection, null);
  assert.equal(result.families[0]!.evidenceValid, false);
  assert.equal(result.families[1]!.projection, null);
});

test("chart actuals are six completed calendar months with admitted counts, scoped providers and unknown gaps", () => {
  const a = input();
  a.visits.push(visit("other", "2026-09-01", 2));
  const r = reviewedGrowth(a);
  assert.deepEqual(r.actualMonths.map(m=>m.month), ['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09']);
  assert.equal(r.actualMonths.at(-1)!.sessions,2);
  assert.equal(r.actualMonths.find(m=>m.month==='2026-08')!.sessions,0);
  a.coverage=[{clinicianId:1,start:'2026-06-01',end:'2026-10-21'}];
  assert.equal(reviewedGrowth(a).actualMonths[0]!.sessions,null);
  assert.equal(reviewedGrowth(a).actualMonths.at(-1)!.sessions,2);
});
