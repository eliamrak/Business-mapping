import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyWorkspace, staffTermSchema, type Context } from "@workspace/practice/hub";
import { staffPayAtEditScope } from "./staff-pay-editor.ts";

const member: Context["staff"][number] = {
  id: 1, goalId: 1, label: "Synthetic", classification: "w2", annualSalary: null,
  hourlyRate: 18, hoursPerWeek: 10, weeksPerYear: 48,
  w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0,
};
const term = (effectiveDate: string, hourlyRate: number, end: string | null = null) =>
  staffTermSchema.parse({ id: randomUUID(), staffMemberId: 1, effectiveDate, end, hourlyRate });

test("staff year editor uses its annual default rather than the horizon's dated override", () => {
  const workspace = emptyWorkspace("2026-10-01");
  workspace.staffTerms = [term("2026-01-01", 22, "2026-12-31"), term("2026-10-16", 24)];
  workspace.staffTerms[0].hoursPerWeek = 12;
  const before = structuredClone({ workspace, member });
  assert.equal(staffPayAtEditScope(workspace, member, { year: 2026, effectiveDate: null }).hourlyRate, 22);
  assert.equal(staffPayAtEditScope(workspace, member, { year: 2026, effectiveDate: "2026-10-15" }).hourlyRate, 22);
  const dated = staffPayAtEditScope(workspace, member, { year: 2026, effectiveDate: "2026-10-16" });
  assert.equal(dated.hourlyRate, 24);
  assert.equal(dated.hoursPerWeek, 12);
  assert.deepEqual({ workspace, member }, before);
});

test("a January1 dated exception is not the annual-default edit value", () => {
  const workspace = emptyWorkspace("2026-01-01");
  workspace.staffTerms = [term("2026-01-01", 22, "2026-12-31"), term("2026-01-01", 24)];
  assert.equal(staffPayAtEditScope(workspace, member, { year: 2026, effectiveDate: null }).hourlyRate, 22);
  assert.equal(staffPayAtEditScope(workspace, member, { year: 2026, effectiveDate: "2026-01-01" }).hourlyRate, 24);
});

test("missing annual terms inherit base or earlier open terms, never a later same-year exception", () => {
  const workspace = emptyWorkspace("2026-01-01");
  workspace.staffTerms = [term("2026-10-16", 24)];
  assert.equal(staffPayAtEditScope(workspace, member, { year: 2026, effectiveDate: null }).hourlyRate, 18);
  workspace.staffTerms.push(term("2025-06-01", 20));
  assert.equal(staffPayAtEditScope(workspace, member, { year: 2026, effectiveDate: null }).hourlyRate, 20);
});

test("annual salary and hours use the selected scope without changing other staff or years", () => {
  const workspace = emptyWorkspace("2026-01-01");
  workspace.staffTerms = [term("2026-01-01", 22, "2026-12-31"), term("2026-10-16", 24)];
  workspace.staffTerms[0].annualSalary = 12000;
  workspace.staffTerms[1].annualSalary = 24000;
  assert.equal(staffPayAtEditScope(workspace, member, { year: 2026, effectiveDate: null }).annualSalary, 12000);
  assert.equal(staffPayAtEditScope(workspace, member, { year: 2026, effectiveDate: "2026-10-16" }).annualSalary, 24000);
  assert.equal(staffPayAtEditScope(workspace, { ...member, id: 2 }, { year: 2026, effectiveDate: null }).hourlyRate, 18);
  assert.equal(staffPayAtEditScope(workspace, member, { year: 2025, effectiveDate: null }).hourlyRate, 18);
});
