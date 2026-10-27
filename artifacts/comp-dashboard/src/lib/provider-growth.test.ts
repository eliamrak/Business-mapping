import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace,
  eventSchema,
  type Workspace,
  type Context,
} from "@workspace/practice/hub";
import {
  reviewedGrowth,
  DEFAULT_GROWTH_SETTINGS,
  type GrowthObservationInput,
} from "./reviewed-growth-observations.ts";
import { providerGrowth, staffingPlanCandidates } from "./provider-growth.ts";
const providers = [
  { id: 1, label: "Synthetic A", sessionsPerWeek: 10 },
  { id: 2, label: "Synthetic B", sessionsPerWeek: 15 },
];
const v = (clientId: string, date: string, clinicianId: number) => ({
  clientId,
  date,
  clinicianId,
});
function input(): GrowthObservationInput {
  const periods = Array.from({ length: 9 }, (_, i) => ({
    id: "m" + i,
    start: `2026-${String(i + 1).padStart(2, "0")}-01`,
    end: new Date(Date.UTC(2026, i + 1, 0)).toISOString().slice(0, 10),
    archived: false,
    funnelComplete: true,
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
      v("shared", "2026-01-01", 1),
      v("shared", "2026-02-01", 2),
      v("shared", "2026-09-01", 1),
      v("shared", "2026-09-01", 2),
      v("transfer", "2026-07-01", 1),
      v("transfer", "2026-07-15", 1),
      v("transfer", "2026-09-15", 2),
      v("early", "2026-09-20", 1),
    ],
    consults: [],
    coverage: providers.map((p) => ({
      clinicianId: p.id,
      start: "2025-01-01",
      end: "2026-10-21",
    })),
    clinicianIds: [1, 2],
    weeklyCapacity: 25,
    weeksPerYear: 48,
    settings: { ...DEFAULT_GROWTH_SETTINGS },
    scenario: false,
  };
}
test("same cutoff, global qualification, shared client pairs and transfers reconcile", () => {
  const a = input(),
    practice = reviewedGrowth(a),
    result = providerGrowth(a, practice, providers);
  assert.equal(result.cutoff, "2026-09-30");
  assert.deepEqual(result.practiceStock, { established: 2, early: 1 });
  assert.equal(result.providerStockPairs, 4);
  assert.equal(result.rows[0]!.stock!.established, 1);
  assert.equal(result.rows[1]!.stock!.established, 2);
  for (let i = 0; i < 2; i++)
    assert.equal(
      result.rows.reduce((s, p) => s + p.families[i]!.attendedSessions, 0),
      practice.families[i]!.attendedSessions,
    );
  assert.equal(result.rows[1]!.families[0]!.firstObservedStarts, 0);
  assert.equal(result.rows[1]!.families[0]!.transferClients, 1);
  assert.ok(
    result.rows.every((r) =>
      r.families.every(
        (f) => f.basis === "unavailable" && f.projection === null,
      ),
    ),
  );
});
test("proxy opt-in never fabricates attributed leads or allocates the waiting pipeline", () => {
  const a = input(),
    baseline = JSON.stringify(a),
    practice = reviewedGrowth(a);
  const settings = {
    ...a.settings,
    providerPlans: {
      "1": {
        usePracticeProxy: true,
        monthlyLeads: { "2026-10": 5 },
        reserve: 0,
      },
    },
  };
  const result = providerGrowth({ ...a, settings }, practice, providers),
    family = result.rows[0]!.families[0]!;
  assert.equal(family.basis, "practice-proxy-scenario");
  assert.equal(family.standardLeadPace, null);
  assert.equal(family.suitability, "unknown");
  assert.ok(family.projection);
  assert.equal(family.leadSeries[0], 5);
  assert.match(family.pendingPipeline, /Zero/);
  assert.equal(result.rows[1]!.families[0]!.projection, null);
  assert.equal(JSON.stringify(a), baseline);
  assert.deepEqual(
    reviewedGrowth({ ...a, settings }).families.map((f) => f.projection),
    practice.families.map((f) => f.projection),
  );
});
test("recorded provider attribution remains separate from practice-average response", () => {
  const a = input();
  a.workspace.funnels = a.workspace.periods.map((p) => ({
    periodId: p.id,
    scope: "source",
    clinicianId: 1,
    leads: 4,
    clients: 1,
    campaignId: null,
    sourceName: "synthetic referral",
  })) as typeof a.workspace.funnels;
  const result = providerGrowth(a, reviewedGrowth(a), providers);
  assert.equal(
    result.rows[0]!.families[0]!.basis,
    "provider-attributed-aggregate",
  );
  assert.equal(result.rows[0]!.families[0]!.standardLeadPace, 4);
  assert.equal(result.rows[1]!.families[0]!.basis, "unavailable");
});
test("allocations exceeding practice lead series and individual capacity are flagged", () => {
  const a = input();
  a.settings = {
    ...a.settings,
    providerPlans: {
      "1": {
        usePracticeProxy: true,
        monthlyLeads: { "2026-10": 1000 },
        reserve: 0,
      },
      "2": {
        usePracticeProxy: true,
        monthlyLeads: { "2026-10": 1000 },
        reserve: 0,
      },
    },
  };
  const result = providerGrowth(a, reviewedGrowth(a), providers);
  assert.equal(result.allocation[0]!.months[0]!.assigned, 2000);
  assert.equal(result.allocation[0]!.months[0]!.overallocated, true);
  assert.ok(
    result.allocation[0]!.months.some((m) =>
      m.overloaded.includes("Synthetic A"),
    ),
  );
  assert.equal(result.suitability, "unknown");
});
test("provider history cannot silently roll to a different cutoff or include future visits", () => {
  const a = input(),
    practice = reviewedGrowth(a),
    before = providerGrowth(a, practice, providers);
  a.visits = [
    ...a.visits,
    v("early", "2026-10-01", 2),
    v("early", "2026-10-02", 2),
  ];
  const after = providerGrowth(a, practice, providers);
  assert.deepEqual(after, before);
  a.coverage = a.coverage.filter((c) => c.clinicianId !== 2);
  const missing = providerGrowth(a, practice, providers);
  assert.ok(missing.rows.every((r) => r.stock === null));
});
test("saved staffing event mapping is opt-in, idempotent, exact for whole-month simple events", () => {
  const workspace = emptyWorkspace("2026-10-27");
  workspace.events = [
    eventSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Synthetic hire",
      date: "2027-01-01",
      field: "clinician.hire",
      targetId: "1",
      value: 20,
      delayMonths: 2,
      rampMonths: 3,
    }),
  ];
  const context = { clinicians: providers, staff: [], sessions: [] } as Context;
  const before = JSON.stringify(workspace);
  const result = staffingPlanCandidates(workspace, context, []);
  assert.deepEqual(result.overlays[0], {
    id: "plan-event:" + workspace.events[0]!.id,
    name: "Synthetic hire",
    startMonth: "2027-03",
    weeklyCapacity: 20,
    rampMonths: 3,
  });
  assert.equal(
    staffingPlanCandidates(workspace, context, result.overlays).overlays.length,
    0,
  );
  assert.equal(JSON.stringify(workspace), before);
  workspace.events[0]!.date = "2027-01-15";
  assert.equal(
    staffingPlanCandidates(workspace, context, []).overlays.length,
    0,
  );
  assert.match(
    staffingPlanCandidates(workspace, context, []).issues[0]!,
    /review/,
  );
});
test("ambiguous or duplicate saved hire identities are never guessed", () => {
  const workspace = emptyWorkspace("2026-10-27");
  const e = eventSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    name: "Ambiguous",
    date: "2027-01-01",
    field: "clinician.hire",
    targetId: "999",
    value: 20,
  });
  workspace.events = [e];
  const context = { clinicians: providers, staff: [], sessions: [] } as Context;
  assert.equal(
    staffingPlanCandidates(workspace, context, []).overlays.length,
    0,
  );
  e.targetId = "1";
  workspace.events = [e, { ...e }];
  assert.equal(
    staffingPlanCandidates(workspace, context, []).overlays.length,
    0,
  );
});
test("proxy cannot bypass historical source uncertainty", () => {
  const a = input();
  a.visits.push(v("old-ended", "2025-11-01", 1));
  a.excludedTreatmentEvidence = [v("old-ended", "2026-01-15", 1)];
  a.settings = {
    ...a.settings,
    providerPlans: {
      "1": {
        usePracticeProxy: true,
        monthlyLeads: { "2026-10": 5 },
        reserve: 0,
      },
    },
  };
  const practice = reviewedGrowth(a);
  const result = providerGrowth(a, practice, providers);
  assert.equal(result.rows[0]!.families[1]!.evidenceValid, false);
  assert.equal(result.rows[0]!.families[1]!.projection, null);
  assert.match(result.rows[0]!.families[1]!.planningReason!, /Unresolved/);
});
test("mixed assigned and unassigned source leads never become a complete provider denominator", () => {
  const a = input();
  a.workspace.funnels = a.workspace.periods.flatMap((p) => [
    {
      periodId: p.id,
      scope: "source",
      clinicianId: 1,
      leads: 4,
      clients: 1,
      campaignId: null,
      sourceName: "assigned",
    },
    {
      periodId: p.id,
      scope: "source",
      clinicianId: null,
      leads: 6,
      clients: 1,
      campaignId: null,
      sourceName: "unassigned",
    },
  ]) as typeof a.workspace.funnels;
  const practice = reviewedGrowth(a),
    result = providerGrowth(a, practice, providers);
  assert.equal(result.rows[0]!.families[0]!.projection, null);
  assert.equal(result.rows[0]!.families[0]!.standardLeadPace, null);
  assert.equal(result.rows[0]!.families[0]!.attributionIncomplete, true);
  const proxy = providerGrowth(
    {
      ...a,
      settings: {
        ...a.settings,
        providerPlans: {
          "1": {
            usePracticeProxy: true,
            monthlyLeads: { "2026-10": 2 },
            reserve: 0,
          },
        },
      },
    },
    practice,
    providers,
  );
  assert.equal(proxy.rows[0]!.families[0]!.basis, "practice-proxy-scenario");
  assert.ok(proxy.rows[0]!.families[0]!.projection);
});
test("distinct linked hires may match, but unlinked identical overlays need review", () => {
  const workspace = emptyWorkspace("2026-10-27");
  const one = eventSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    name: "One",
    date: "2027-01-01",
    field: "clinician.hire",
    targetId: "1",
    value: 20,
    delayMonths: 0,
    rampMonths: 2,
  });
  const two = {
    ...one,
    id: "00000000-0000-4000-8000-000000000002",
    name: "Two",
  };
  workspace.events = [one, two];
  const context = { clinicians: providers, staff: [], sessions: [] } as Context;
  const first = staffingPlanCandidates(workspace, context, []);
  assert.equal(first.overlays.length, 2);
  assert.equal(
    staffingPlanCandidates(workspace, context, [first.overlays[0]!]).overlays
      .length,
    1,
  );
  const duplicate = {
    id: "manual",
    startMonth: "2027-01",
    weeklyCapacity: 20,
    rampMonths: 2,
  };
  assert.equal(
    staffingPlanCandidates(workspace, context, [duplicate]).overlays.length,
    0,
  );
});
test('proxy inherits provisional lead evidence instead of claiming complete provider conversion',()=>{
 const a=input();a.workspace.periods[8]!.funnelComplete=false;a.settings={...a.settings,providerPlans:{'1':{usePracticeProxy:true,monthlyLeads:{'2026-10':2},reserve:0}}};
 const result=providerGrowth(a,reviewedGrowth(a),providers);
 assert.equal(result.rows[0]!.families[0]!.planningProvisional,true);assert.equal(result.rows[0]!.families[1]!.planningProvisional,true);
});
