import test from "node:test";
import assert from "node:assert/strict";
import { planInputSignature, planRevisionSignature, planFocusHighlights } from "./plan-focus.ts";

test("plan revision signature changes when new actual data leaves rounded deltas unchanged", () => {
  const before = { profitDelta: 100.001, sessions: [{ id: 1, completed: 20 }], mapping: { Owner: 1 } };
  assert.notEqual(planInputSignature(before), planInputSignature({ ...before, profitDelta: 100.002 }));
  assert.notEqual(planInputSignature(before), planInputSignature({ ...before, sessions: [{ id: 1, completed: 21 }] }));
  assert.notEqual(planInputSignature(before), planInputSignature({ ...before, mapping: { Owner: 2 } }));
});

test("signature is insensitive to object key order and bounded for large imports", () => {
  assert.equal(planInputSignature({ a: 1, b: { c: 2, d: 3 } }), planInputSignature({ b: { d: 3, c: 2 }, a: 1 }));
  assert.ok(planInputSignature({ rows: Array.from({ length: 10000 }, (_, id) => ({ id, count: id })) }).length < 64);
});

test("material event, term, hiring and campaign changes mark an adopted plan stale", () => {
  const before = { settings: {}, budgets: [], rooms: [], events: [], terms: [], hiring: [], campaigns: [], categories: [], focusedPlanAdoptions: [] };
  const signature = (workspace: Record<string, unknown>) => planRevisionSignature({}, workspace, {}, [], {});
  for (const collection of ["events", "terms", "hiring", "campaigns", "categories"])
    assert.notEqual(signature(before), signature({ ...before, [collection]: [{ amount: 1000 }] }), collection);
  assert.equal(signature(before), signature({ ...before, focusedPlanAdoptions: [{ adoptedAt: "now" }] }));
});

test("Sessions and Rooms focus persists their own highlights", () => {
  assert.deepEqual(planFocusHighlights(["Sessions", "Rooms"], { Revenue: "Revenue +100", Profit: "Profit +20", Sessions: "Sessions +10", Rooms: "Room utilization 50%" }), ["Sessions +10", "Room utilization 50%"]);
});
