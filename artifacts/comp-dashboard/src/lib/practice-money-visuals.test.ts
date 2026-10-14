import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace,
  periodSchema,
  categorySchema,
  transactionSchema,
  type ForecastMonth,
} from "@workspace/practice/hub";
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
    month("2026-04-01", null),
    month("2026-02-01", 200),
    month("2026-03-01", 900),
  ];

  const firstTwo = periodOverheadSummary(periods, "2026-01-01", "2026-02-28");
  const march = periodOverheadSummary(periods, "2026-03-01", "2026-03-31");

  assert.deepEqual(
    firstTwo.rows.map((row) => row.date),
    ["2026-01-01", "2026-02-01"],
  );
  assert.equal(firstTwo.average, 150);
  assert.equal(march.average, 900);
});

test("overall start sentinel bounds monthly enumeration to available sources", () => {
  const summary = periodOverheadSummary(
    [month("2026-01-01", 100), month("2026-02-01", 200)],
    "0000-01-01",
    "2026-02-28",
  );
  assert.deepEqual(
    summary.months.map((row) => row.date),
    ["2026-01-01", "2026-02-01"],
  );
  assert.equal(summary.average, 150);
  const empty = periodOverheadSummary([], "0000-01-01", "2026-02-28");
  assert.deepEqual(empty.months, []);
  assert.equal(empty.average, null);
});

test("overall sentinels retain coverage gaps between actual source months", () => {
  const { workspace, addPeriod } = expenseWorkspace();
  addPeriod("2026-01-01", "2026-01-31");
  addPeriod("2026-03-01", "2026-03-31");
  const summary = periodOverheadSummary([], "0000-01-01", "9999-12-31", {
    workspace,
  });
  assert.deepEqual(
    summary.months.map((row) => row.date),
    ["2026-01-01", "2026-02-01", "2026-03-01"],
  );
  assert.ok(summary.months[1].reasons.includes("incomplete-month"));
  assert.equal(summary.average, null);
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
  assert.equal(anchored?.eta, "2027-04-14");
});

test("overhead uses full totals for every overlapping calendar month", () => {
  const summary = periodOverheadSummary(
    [
      month("2025-12-01", 900),
      month("2026-01-01", 100),
      month("2026-02-01", 200),
      month("2026-03-01", 900),
    ],
    "2026-01-15",
    "2026-02-14",
  );
  assert.deepEqual(summary.values, [100, 200]);
  assert.equal(summary.average, 150);
});

const actualPeriod = (
  start: string,
  end: string,
  overhead: number | null,
): ForecastMonth => ({
  ...month(end, overhead),
  periodStart: start,
});

test("overhead sums within-month actual periods before averaging months", () => {
  const summary = periodOverheadSummary(
    [
      actualPeriod("2026-10-16", "2026-10-31", 1000),
      actualPeriod("2026-10-01", "2026-10-15", 1000),
    ],
    "2026-10-08",
    "2026-10-20",
  );
  assert.equal(summary.average, 2000);
  assert.deepEqual(summary.values, [2000]);
  assert.equal(summary.complete, true);
  assert.deepEqual(
    summary.rows.map((row) => row.date),
    ["2026-10-01"],
  );
  assert.deepEqual(
    summary.months[0].sources.map((source) => ({
      index: source.index,
      start: source.start,
      end: source.end,
      overhead: source.overhead,
      basis: source.basis,
    })),
    [
      {
        index: 1,
        start: "2026-10-01",
        end: "2026-10-15",
        overhead: 1000,
        basis: "period-total",
      },
      {
        index: 0,
        start: "2026-10-16",
        end: "2026-10-31",
        overhead: 1000,
        basis: "period-total",
      },
    ],
  );
});

test("cross-month actual period is excluded in both touched months without proration", () => {
  const source = actualPeriod("2026-01-25", "2026-02-07", 1400);
  const summary = periodOverheadSummary([source], "2026-01-15", "2026-02-14");
  assert.equal(summary.average, null);
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.rows, []);
  assert.deepEqual(summary.values, []);
  assert.deepEqual(
    summary.months.map((row) => ({
      date: row.date,
      overhead: row.overhead,
      status: row.status,
    })),
    [
      { date: "2026-01-01", overhead: null, status: "unknown" },
      { date: "2026-02-01", overhead: null, status: "unknown" },
    ],
  );
  assert.ok(
    summary.months.every((row) => row.reasons.includes("cross-month-period")),
  );
  assert.equal(summary.excludedSources.length, 1);
  assert.equal(summary.excludedSources[0].overhead, 1400);
  assert.equal(summary.excludedSources[0].excludedReason, "cross-month-period");
  const januaryOnly = periodOverheadSummary(
    [source],
    "2026-01-01",
    "2026-01-31",
  );
  assert.equal(januaryOnly.months[0].sources[0].start, "2026-01-25");
  assert.equal(januaryOnly.average, null);
});

test("partial month totals are unknown even when they cover the selected days", () => {
  const summary = periodOverheadSummary(
    [
      actualPeriod("2026-10-01", "2026-10-14", 1000),
      actualPeriod("2026-10-15", "2026-10-28", 1000),
    ],
    "2026-10-02",
    "2026-10-20",
  );
  assert.equal(summary.average, null);
  assert.equal(summary.months[0].overhead, null);
  assert.ok(summary.months[0].reasons.includes("incomplete-month"));
  assert.equal(summary.months[0].sources.length, 2);
});

test("unknown months gate the overall average and retain known monthly totals", () => {
  const summary = periodOverheadSummary(
    [
      actualPeriod("2026-01-01", "2026-01-31", 100),
      actualPeriod("2026-02-01", "2026-02-28", null),
    ],
    "2026-01-15",
    "2026-03-14",
  );
  assert.equal(summary.average, null);
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.values, [100]);
  assert.ok(summary.months[1].reasons.includes("missing-overhead"));
  assert.ok(summary.months[2].reasons.includes("incomplete-month"));
});

test("overlapping actual periods never double count a monthly total", () => {
  const summary = periodOverheadSummary(
    [
      actualPeriod("2026-10-01", "2026-10-20", 1000),
      actualPeriod("2026-10-15", "2026-10-31", 1000),
    ],
    "2026-10-01",
    "2026-10-31",
  );
  assert.equal(summary.average, null);
  assert.ok(summary.months[0].reasons.includes("overlapping-periods"));
});

test("monthly inputs retain provenance and full zero totals; undated period boundaries stay unknown", () => {
  const monthly = periodOverheadSummary(
    [month("2026-02-01", 0)],
    "2026-02-14",
    "2026-02-15",
  );
  assert.equal(monthly.average, 0);
  assert.equal(monthly.months[0].sources[0].basis, "monthly-input");
  assert.equal(monthly.months[0].sources[0].end, "2026-02-28");
  const ambiguous = periodOverheadSummary(
    [month("2026-02-14", 100)],
    "2026-02-01",
    "2026-02-28",
  );
  assert.equal(ambiguous.average, null);
  assert.ok(ambiguous.months[0].reasons.includes("missing-period-start"));
});

function expenseWorkspace() {
  const workspace = emptyWorkspace("2026-10-14");
  const expense = categorySchema.parse({
    id: crypto.randomUUID(),
    name: "Rent",
    kind: "facility",
  });
  workspace.categories.push(expense);
  const addPeriod = (start: string, end: string, expensesComplete = true) => {
    const period = periodSchema.parse({
      id: crypto.randomUUID(),
      name: start,
      start,
      end,
      status: "finalized",
      expensesComplete,
    });
    workspace.periods.push(period);
    return period;
  };
  const addExpense = (
    periodId: string,
    date: string,
    amount: number,
    categoryId = expense.id,
  ) => {
    const transaction = transactionSchema.parse({
      id: crypto.randomUUID(),
      periodId,
      date,
      amount,
      categoryId,
      description: "Recorded expense",
    });
    workspace.transactions.push(transaction);
    return transaction;
  };
  return { workspace, addPeriod, addExpense };
}

test("workspace facts sum actual biweekly expenses to a full monthly total", () => {
  const { workspace, addPeriod, addExpense } = expenseWorkspace();
  const first = addPeriod("2026-10-01", "2026-10-15");
  const second = addPeriod("2026-10-16", "2026-10-31");
  const expense1 = addExpense(first.id, "2026-10-02", 1000);
  const expense2 = addExpense(second.id, "2026-10-20", 1000);
  const summary = periodOverheadSummary(
    [
      actualPeriod(first.start, first.end, 1000),
      actualPeriod(second.start, second.end, 1000),
    ],
    "2026-10-08",
    "2026-10-20",
    { workspace },
  );
  assert.equal(summary.average, 2000);
  assert.equal(summary.months[0].basis, "dated-transactions");
  assert.deepEqual(
    summary.months[0].transactions.map((transaction) => transaction.id),
    [expense1.id, expense2.id],
  );
  assert.deepEqual(
    summary.months[0].sources.map((source) => source.periodId),
    [first.id, second.id],
  );
});

test("dated transactions resolve cross-month actual expenses without proration", () => {
  const { workspace, addPeriod, addExpense } = expenseWorkspace();
  const first = addPeriod("2026-01-01", "2026-01-24");
  const crossing = addPeriod("2026-01-25", "2026-02-07");
  const last = addPeriod("2026-02-08", "2026-02-28");
  addExpense(first.id, "2026-01-05", 50);
  const january = addExpense(crossing.id, "2026-01-30", 100);
  const february = addExpense(crossing.id, "2026-02-02", 200);
  addExpense(last.id, "2026-02-20", 70);
  const summary = periodOverheadSummary(
    [
      actualPeriod(first.start, first.end, 50),
      actualPeriod(crossing.start, crossing.end, 300),
      actualPeriod(last.start, last.end, 70),
    ],
    "2026-01-15",
    "2026-02-14",
    { workspace, context: undefined },
  );
  assert.deepEqual(summary.values, [150, 270]);
  assert.equal(summary.average, 210);
  assert.equal(summary.complete, true);
  assert.equal(summary.excludedSources.length, 0);
  assert.ok(
    summary.months[0].transactions.some(
      (transaction) => transaction.id === january.id,
    ),
  );
  assert.ok(
    !summary.months[0].transactions.some(
      (transaction) => transaction.id === february.id,
    ),
  );
});

test("workspace actual completeness gates zeros, partial months and incomplete expenses", () => {
  const { workspace, addPeriod } = expenseWorkspace();
  addPeriod("2026-01-01", "2026-01-31");
  addPeriod("2026-02-01", "2026-02-28", false);
  addPeriod("2026-03-01", "2026-03-14");
  const summary = periodOverheadSummary([], "2026-01-15", "2026-03-14", {
    workspace,
  });
  assert.equal(summary.months[0].overhead, 0);
  assert.equal(summary.months[1].overhead, null);
  assert.ok(summary.months[1].reasons.includes("incomplete-expenses"));
  assert.ok(summary.months[2].reasons.includes("incomplete-month"));
  assert.equal(summary.average, null);
});

test("workspace actuals exclude payroll/marketing and draft/archived periods", () => {
  const { workspace, addPeriod, addExpense } = expenseWorkspace();
  const period = addPeriod("2026-01-01", "2026-01-31");
  const archived = addPeriod("2026-01-01", "2026-01-31");
  archived.archived = true;
  const draft = addPeriod("2026-01-01", "2026-01-31");
  draft.status = "draft";
  const marketing = categorySchema.parse({
    id: crypto.randomUUID(),
    name: "Ads",
    kind: "marketing",
  });
  workspace.categories.push(marketing);
  addExpense(period.id, "2026-01-10", 100);
  addExpense(period.id, "2026-01-10", 900, marketing.id);
  addExpense(archived.id, "2026-01-10", 900);
  addExpense(draft.id, "2026-01-10", 900);
  assert.equal(
    periodOverheadSummary([], "2026-01-01", "2026-01-31", { workspace })
      .average,
    100,
  );
});

function projectionFixture(
  balance: number | null = 600,
  balanceDate: string | null = "2026-10-14",
) {
  const workspace = emptyWorkspace("2026-10-14");
  workspace.fundGoals.push({
    id: "building",
    name: "Building Fund",
    archived: false,
    notes: "",
    sourceAttachmentId: null,
    amount: 1200,
    date: null,
    currentBalance: balance,
    balanceDate,
  });
  workspace.allocations.push({
    id: "building-allocation",
    name: "Building Fund",
    archived: false,
    notes: "",
    sourceAttachmentId: null,
    kind: "reserve",
    percent: 100,
    household: false,
    start: "2026-01-01",
    end: null,
  });
  return workspace;
}

test("dated balance anchors ETA and actual/projected trajectory independently of selected month", () => {
  const workspace = projectionFixture();
  const project = (selected: string | undefined) =>
    fundProjectionSummary(
      workspace.fundGoals[0],
      workspace.allocations,
      { reserves: 100 } as ForecastMonth["values"],
      selected,
    );
  const result = project("2028-01-01")!;
  assert.equal(result.eta, "2027-04-14");
  assert.deepEqual(project(undefined), result);
  assert.equal(result.projectionStartDate, "2026-10-14");
  assert.equal(result.projectionLineStyle, "dotted");
  assert.deepEqual(result.trajectory[0], {
    date: "2026-10-14",
    balance: 600,
    kind: "actual",
  });
  assert.deepEqual(result.trajectory[1], {
    date: "2026-11-14",
    balance: 700,
    kind: "projected",
  });
  assert.deepEqual(result.trajectory.at(-1), {
    date: "2027-04-14",
    balance: 1200,
    kind: "projected",
  });
  assert.ok(
    result.assumptions.some(
      (text) => text.includes("100") && text.includes("monthly"),
    ),
  );
});

test("blank balance is an explicit zero assumption, never an actual dated balance", () => {
  const workspace = projectionFixture(null, null);
  const result = fundProjectionSummary(
    workspace.fundGoals[0],
    workspace.allocations,
    { reserves: 100 } as ForecastMonth["values"],
    "2026-10-01",
  )!;
  assert.equal(result.current, 0);
  assert.equal(result.anchorDate, null);
  assert.equal(result.projectionStartDate, "2026-10-01");
  assert.deepEqual(result.trajectory[0], {
    date: "2026-10-01",
    balance: 0,
    kind: "projected",
  });
  assert.ok(
    result.assumptions.some(
      (text) => text.includes("blank") && text.includes("0"),
    ),
  );
  assert.ok(result.assumptions.some((text) => text.includes("selected month")));
});

test("monthly projection clamps month ends without drifting the anchor day", () => {
  const workspace = projectionFixture(1000, "2026-01-31");
  const result = fundProjectionSummary(
    workspace.fundGoals[0],
    workspace.allocations,
    { reserves: 100 } as ForecastMonth["values"],
    "2028-01-01",
  )!;
  assert.equal(result.eta, "2026-03-31");
  assert.deepEqual(
    result.trajectory.map((point) => point.date),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
});

test("unavailable contributions preserve actual anchor without invented growth", () => {
  const workspace = projectionFixture();
  const result = fundProjectionSummary(
    workspace.fundGoals[0],
    workspace.allocations,
    { reserves: null } as ForecastMonth["values"],
    "2028-01-01",
  )!;
  assert.equal(result.contribution, null);
  assert.equal(result.eta, null);
  assert.deepEqual(result.trajectory, [
    { date: "2026-10-14", balance: 600, kind: "actual" },
  ]);
  assert.ok(result.assumptions.some((text) => text.includes("unavailable")));
});

test("long projections bound chart data while retaining full ETA", () => {
  const workspace = projectionFixture(0);
  const result = fundProjectionSummary(
    workspace.fundGoals[0],
    workspace.allocations,
    { reserves: 1 } as ForecastMonth["values"],
    "2028-01-01",
  )!;
  assert.equal(result.eta, "2126-10-14");
  assert.equal(result.trajectory.length, 121);
  assert.equal(result.trajectoryTruncated, true);
});

test("missing dates or zero contributions do not invent an ETA", () => {
  const workspace = projectionFixture(null, null);
  const result = fundProjectionSummary(
    workspace.fundGoals[0],
    workspace.allocations,
    { reserves: 0 } as ForecastMonth["values"],
    undefined,
  )!;
  assert.equal(result.contribution, 0);
  assert.equal(result.eta, null);
  assert.deepEqual(result.trajectory, []);
});
