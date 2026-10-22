import assert from "node:assert/strict";
import { test } from "node:test";
import { importFailureStage, importFeedbackTitle, importReceipt } from "./import-feedback.ts";

test("validation, save acknowledgement and later reload are distinct states", () => {
  assert.equal(importFeedbackTitle({ stage: "validating" }), "Checking your file");
  assert.equal(importFeedbackTitle({ stage: "saved" }), "Saved to practice storage");
  assert.equal(importFeedbackTitle({ stage: "loaded" }), "Loaded from saved history");
});
test("receipts describe package rows, not invented added sessions", () => {
  assert.match(importReceipt({ attendance: 164, billing: 109 }, "added"), /164 attendance rows and 109 billing rows.*not new-session totals/);
  assert.match(importReceipt({ attendance: 164, billing: 109 }, "duplicate"), /already saved; no additional rows/);
});
test("lost save acknowledgement never asserts that no data was saved", () => {
  assert.equal(importFailureStage(false), "invalid");
  assert.equal(importFailureStage(true, 400), "invalid");
  assert.equal(importFailureStage(true, 409), "invalid");
  assert.equal(importFailureStage(true, 500), "unconfirmed");
  assert.equal(importFailureStage(true), "unconfirmed");
});
