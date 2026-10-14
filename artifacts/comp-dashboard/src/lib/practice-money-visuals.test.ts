import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, type ForecastMonth } from "@workspace/practice/hub";
import {
  fundProjectionSummary,
  periodOverheadSummary,
} from "./practice-money-visuals.ts";

const month = (date: string, overhead: number | null): ForecastMonth =>
  ({
    date,
    values: { overhead },
    channels: {},
    warnings: [],
  }) as ForecastMonth;

test("overhead summary responds to selected period", () => {
  const periods = [
    month("2026-01-01", 100),
    month("2026-01-15", null),
    month("2026-02-01", 200),
    month("2026-03-01", 900),
  ];

  const firstTwo = periodOverheadSummary(
    periods,
    "2026-01-01",
    "2026-02-28",
  );
  const march = periodOverheadSummary(periods, "2026-03-01", "2026-03-31");

  assert.deepEqual(
    firstTwo.rows.map((row) => row.date),
    ["2026-01-01", "2026-02-01"],
  );
  assert.equal(firstTwo.average, 150);
  assert.equal(march.average, 900);
});

test("fund projection keeps blank balance as zero with no dated anchor", () => {
  const workspace = emptyWorkspace("2026-10-14");
  workspace.fundGoals.push({
    id: crypto.randomUUID(),
    name: "Building Fund",
    archived: false,
    notes: "",
    sourceAttachmentId: null,
    amount: 1200,
    date: null,
    currentBalance: null,
    balanceDate: null,
  });
  workspace.allocations.push({
    id: crypto.randomUUID(),
    name: "Building Fund",
    archived: false,
    notes: "",
    sourceAttachmentId: null,
    kind: "reserve",
    percent: 100,
    household: false,
    start: "2026-10-01",
    end: null,
  });

  const blank = fundProjectionSummary(
    workspace.fundGoals[0],
    workspace.allocations,
    { reserves: 100 } as ForecastMonth["values"],
    "2026-10-01",
  );
  workspace.fundGoals[0].currentBalance = 600;
  workspace.fundGoals[0].balanceDate = "2026-10-14";
  const anchored = fundProjectionSummary(
    workspace.fundGoals[0],
    workspace.allocations,
    { reserves: 100 } as ForecastMonth["values"],
    "2026-10-01",
  );

  assert.equal(blank?.current, 0);
  assert.equal(blank?.anchorDate, null);
  assert.equal(blank?.eta, "2027-10-01");
  assert.equal(anchored?.current, 600);
  assert.equal(anchored?.anchorDate, "2026-10-14");
  assert.equal(anchored?.eta, "2027-04-01");
});
