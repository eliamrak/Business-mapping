import test from "node:test";
import assert from "node:assert/strict";
import { completedFundGoalStatus } from "./completed-fund-goals.ts";

const goal = { name: "Building Fund", amount: 1000, date: null, currentBalance: 1000, balanceDate: "2026-10-01" };
test("fund achievement requires a completed review and recorded dated balance", () => {
  assert.equal(completedFundGoalStatus(goal, null).met, false);
  assert.equal(completedFundGoalStatus({ ...goal, currentBalance: null }, "2026-10-14").met, false);
  assert.equal(completedFundGoalStatus({ ...goal, balanceDate: "2026-10-15" }, "2026-10-14").met, false);
  assert.equal(completedFundGoalStatus(goal, "2026-10-14").met, true);
  assert.equal(completedFundGoalStatus({ ...goal, currentBalance: 999 }, "2026-10-14").met, false);
});
