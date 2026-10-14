import { test } from "node:test";
import assert from "node:assert/strict";
import { metricComparison, hasUniqueClinicianIdentity } from "./metric-comparison.ts";

test("all contributors use a shared scale and Whole Practice ends every comparison", () => {
  const rows = [{ id: "practice", label: "Whole Practice", practice: true, value: 60 }, { id: "1", label: "Elia", value: 20 }, { id: "2", label: "Erin", value: 40 }];
  const before = structuredClone(rows);
  const result = metricComparison(rows);
  assert.deepEqual(result.map((row) => row.label), ["Elia", "Erin", "Whole Practice"]);
  assert.ok(Math.abs(result[1].width! - 100 * 40 / 60) < 1e-10);
  assert.equal(result[0].benchmarkPosition, 100);
  assert.deepEqual(rows, before);
});

test("unknown values never become zero and percentages retain a fixed scale", () => {
  const result = metricComparison([{ id: "1", label: "Elia", value: null }, { id: "2", label: "Erin", value: 0 }, { id: "practice", label: "Whole Practice", practice: true, value: undefined }], true);
  assert.equal(result[0].width, null);
  assert.equal(result[0].benchmarkPosition, null);
  assert.equal(result[1].width, 0);
  assert.equal(result[2].value, null);
});

test("goals and capacity use the same scale without filling unknown observations", () => {
  const result = metricComparison([{ id: "1", label: "Elia", value: NaN, capacity: 30 }, { id: "p", label: "Whole Practice", practice: true, value: 10, goal: 20, capacity: 40 }]);
  assert.equal(result[0].width, null);
  assert.equal(result[0].capacityPosition, 75);
  assert.equal(result[1].width, 25);
  assert.equal(result[1].goalPosition, 50);
});

test("name-only imported metrics require one distinct clinician ID across the roster", () => {
  const people = [{ id: 1, label: "Synthetic Clinician" }, { id: 2, label: " synthetic   clinician " }];
  assert.equal(hasUniqueClinicianIdentity(people, "Synthetic Clinician"), false);
  assert.equal(hasUniqueClinicianIdentity([people[0], { ...people[1], id: 1 }], "Synthetic Clinician"), true, "same-ID aliases do not fabricate two people");
  assert.equal(hasUniqueClinicianIdentity(people, "Missing"), false);
  assert.equal(hasUniqueClinicianIdentity([...people, { id: 3, label: "Erin" }], "erin"), true);
});
