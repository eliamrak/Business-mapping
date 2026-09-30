import { test } from "node:test";
import assert from "node:assert/strict";
import { leadFlowRates } from "./lead-flow-rates.ts";

test("lead flow shows distinct scheduled, show, close and overall-close rates", () => {
  assert.deepEqual(leadFlowRates({ leads: 40, scheduled: 24, attended: 20, clients: 10 }), {
    scheduledConsult: "60%", show: "83%", consultClose: "50%", overallClose: "25%",
  });
});

test("missing counts and zero denominators do not imply a conversion rate", () => {
  assert.deepEqual(leadFlowRates({ leads: 40, scheduled: null, attended: 20, clients: 10 }), {
    scheduledConsult: "-", show: "-", consultClose: "50%", overallClose: "25%",
  });
  assert.deepEqual(leadFlowRates({ leads: 0, scheduled: 0, attended: 0, clients: 0 }), {
    scheduledConsult: "-", show: "-", consultClose: "-", overallClose: "-",
  });
});
