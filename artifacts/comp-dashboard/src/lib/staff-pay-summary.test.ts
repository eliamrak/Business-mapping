import { test } from "node:test";
import assert from "node:assert/strict";
import { staffPaySummary, staffRosterCost } from "./staff-pay-summary.ts";
import { calculateStaffMemberCost } from "@workspace/practice/compensation";

const graceCompatibility = { annualSalary: null, hourlyRate: 18, hoursPerWeek: 10, weeksPerYear: 48, classification: "w2", w2EmployerFicaPct: 7.65, futaSutaPct: 1, workersCompPct: 0.5, otherEmployerBurdenPct: 0 };
const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-8);

test("provided Year 1 Grace compatibility terms reconcile exactly without rounding inputs", () => {
  const before = structuredClone(graceCompatibility);
  const cost = staffPaySummary(graceCompatibility);
  assert.equal(cost.payType, "Hourly");
  close(cost.baseAnnualCost, 8640);
  close(cost.employerBurden, 790.56);
  close(cost.totalAnnualCost, 9430.56);
  close(cost.totalAnnualCost! / 12, 785.88);
  assert.deepEqual(graceCompatibility, before);
});

test("explicit zero weeks stays zero in the shared helper and Team readout", () => {
  const input = { ...graceCompatibility, weeksPerYear: 0 };
  close(calculateStaffMemberCost(input).totalAnnualCost, 0);
  close(staffPaySummary(input).totalAnnualCost, 0);
});

test("zero or omitted salary with complete hourly terms is labeled hourly", () => {
  for (const annualSalary of [0, undefined, null]) {
    const summary = staffPaySummary({ ...graceCompatibility, annualSalary });
    assert.equal(summary.payType, "Hourly");
    close(summary.totalAnnualCost, 9430.56);
  }
  assert.equal(staffPaySummary({ ...graceCompatibility, annualSalary: 12000 }).payType, "Salary");
});

test("missing pay, duration or W2 burden is unknown rather than a zero/default expense", () => {
  for (const patch of [{ hourlyRate: null }, { hoursPerWeek: undefined }, { weeksPerYear: undefined }, { w2EmployerFicaPct: undefined }, { classification: undefined }, { annualSalary: NaN }, { annualSalary: Infinity }, { annualSalary: -1 }]) {
    assert.equal(staffPaySummary({ ...graceCompatibility, ...patch }).totalAnnualCost, null);
  }
  assert.equal(staffPaySummary({ ...graceCompatibility, hourlyRate: null, hoursPerWeek: null }).payType, "Pay unavailable");
  assert.equal(staffPaySummary({ ...graceCompatibility, annualSalary: 0, hourlyRate: null, hoursPerWeek: null }).totalAnnualCost, 0, "an explicitly saved zero salary remains meaningful");
  assert.equal(staffPaySummary({ ...graceCompatibility, classification: "1099", w2EmployerFicaPct: undefined }).totalAnnualCost, 8640);
});

test("unknown staff costs cannot masquerade as a complete roster total", () => {
  close(staffRosterCost([graceCompatibility, graceCompatibility]), 18861.12);
  assert.equal(staffRosterCost([graceCompatibility, { classification: "w2" }]), null);
  assert.equal(staffRosterCost([]), 0);
});
