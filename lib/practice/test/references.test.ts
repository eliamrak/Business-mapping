import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace,
  budgetSchema,
  ruleSchema,
  eventSchema,
  referencedClinicianIds,
} from "../src/hub/index.ts";

test("clinician reference checks include optional budgets and nested rule actions", () => {
  const workspace = emptyWorkspace("2026-09-01");
  workspace.budgets = [
    budgetSchema.parse({
      id: crypto.randomUUID(),
      name: "Supervision",
      start: "2026-09-01",
      categoryId: crypto.randomUUID(),
      amount: 100,
      cadence: "monthly",
      clinicianId: 7,
    }),
  ];
  workspace.rules = [
    ruleSchema.parse({
      id: crypto.randomUUID(),
      name: "Hire",
      action: "Review",
      condition: {
        id: crypto.randomUUID(),
        type: "group",
        logic: "all",
        children: [
          {
            id: crypto.randomUUID(),
            type: "condition",
            metric: "sessions",
            operator: "gt",
            value: 0,
            upper: 100,
            scope: "all",
            clinicianIds: [8],
            periods: 1,
            compareTo: "value",
          },
        ],
      },
      event: eventSchema.parse({
        id: crypto.randomUUID(),
        name: "Hire",
        date: "2026-10-01",
        field: "clinician.hire",
        targetId: "9",
        value: 20,
      }),
    }),
  ];
  assert.deepEqual([...referencedClinicianIds(workspace)].sort(), [7, 8, 9]);
});
