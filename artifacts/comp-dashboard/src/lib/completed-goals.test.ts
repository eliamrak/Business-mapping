import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, type Context } from "@workspace/practice/hub";
import { buildImportedSessionOverlay } from "./import-derived-sessions.ts";
import type { LocalSnapshot } from "./retention-local.ts";
import {
  evaluateCompletedGoal,
  type CompletedGoalInput,
} from "./completed-goals.ts";

function fixture(): CompletedGoalInput {
  return {
    workspace: emptyWorkspace("2026-10-14"),
    context: {
      clinicians: [
        { id: 1, goalId: null },
        { id: 2, goalId: null },
      ],
      sessions: [1, 2].map((clinicianId) => ({
        clinicianId,
        start: "2026-10-01",
        end: "2026-10-14",
        completed: 30,
      })),
    },
    goal: { metric: "sessions", amount: 100, basis: "monthly" },
    asOf: "2026-10-14",
    expected: 200,
  };
}

test("future high session counts cannot complete a goal", () => {
  const input = fixture();
  input.asOf = "2026-10-13";
  assert.equal(evaluateCompletedGoal(input).status, "waiting");
});

test("partial selected-team coverage is insufficient even above target", () => {
  const input = fixture();
  input.context.sessions = [input.context.sessions[0]];
  input.goal!.amount = 10;
  assert.equal(evaluateCompletedGoal(input).status, "insufficient");
});

test("actual achievement takes precedence over a low or absent forecast", () => {
  for (const expected of [0, null, undefined]) {
    const result = evaluateCompletedGoal({ ...fixture(), expected });
    assert.equal(result.status, "met");
    assert.equal(result.date, "2026-10-14");
    assert.equal(result.value, (60 / 14) * 30.4375);
  }
});

test("annual and monthly session targets share the same monthly equivalent", () => {
  const input = fixture();
  input.goal = { metric: "sessions", amount: 1200, basis: "annual" };
  const result = evaluateCompletedGoal(input);
  assert.equal(result.target, 100);
  assert.equal(result.status, "met");
});

test("selected team excludes other teams and planned clinicians", () => {
  const input = fixture();
  input.context.clinicians.push({ id: 3, goalId: 5 }, { id: 4, goalId: null });
  input.workspace.clinicians.push({
    clinicianId: 4,
    start: "2026-10-01",
    end: null,
    status: "planned",
  } as CompletedGoalInput["workspace"]["clinicians"][number]);
  assert.equal(evaluateCompletedGoal(input).status, "met");
  input.workspace.settings.teamId = 5;
  assert.equal(evaluateCompletedGoal(input).status, "insufficient");
});

test("active dates require all active days, including a partial-period starter", () => {
  const input = fixture();
  input.workspace.clinicians.push({
    clinicianId: 2,
    start: "2026-10-08",
    end: null,
    status: "active",
  } as CompletedGoalInput["workspace"]["clinicians"][number]);
  input.context.sessions[1].start = "2026-10-08";
  assert.equal(evaluateCompletedGoal(input).status, "met");
  input.context.sessions[1].start = "2026-10-09";
  assert.equal(evaluateCompletedGoal(input).status, "insufficient");
});

test("monthly financial observations cannot establish biweekly achievement", () => {
  const input = fixture();
  input.goal = { metric: "profit", amount: 100, basis: "monthly" };
  input.financialObservations = [
    { date: "2026-09-30", values: { profit: 10000 } },
  ];
  const result = evaluateCompletedGoal(input);
  assert.equal(result.status, "insufficient");
  assert.equal(result.value, null);
  assert.match(result.message, /biweekly/i);
});

test("financial evidence needs actual provenance and a completed biweekly range", () => {
  const input = fixture();
  input.goal = { metric: "profit", amount: 100, basis: "monthly" };
  const observation = {
    start: "2026-10-01",
    end: "2026-10-14",
    source: "actual" as const,
    values: { profit: 100 },
    basis: "period" as const,
  };
  input.financialObservations = [observation];
  assert.equal(evaluateCompletedGoal(input).status, "met");
  input.asOf = "2026-10-13";
  assert.equal(evaluateCompletedGoal(input).status, "waiting");
  input.asOf = "2026-10-14";
  input.financialObservations = [{ ...observation, source: "forecast" }];
  assert.equal(evaluateCompletedGoal(input).status, "insufficient");
});

test("latest complete actual below target waits even with a high forecast", () => {
  const input = fixture();
  input.context.sessions.forEach((row) => {
    row.completed = 1;
  });
  assert.equal(evaluateCompletedGoal(input).status, "waiting");
  assert.equal(evaluateCompletedGoal(input).forecastMet, true);
});

test("zero or missing targets have no-target status", () => {
  const input = fixture();
  input.goal!.amount = 0;
  assert.equal(evaluateCompletedGoal(input).status, "no-target");
  input.goal = undefined;
  assert.equal(evaluateCompletedGoal(input).status, "no-target");
});

test("duplicate evidence and non-biweekly ranges cannot inflate actuals", () => {
  const input = fixture();
  input.context.sessions.push({ ...input.context.sessions[0] });
  assert.equal(evaluateCompletedGoal(input).status, "insufficient");
  input.context.sessions = fixture().context.sessions.map((row) => ({
    ...row,
    start: "2026-10-10",
  }));
  assert.equal(evaluateCompletedGoal(input).status, "insufficient");
});

test("only inclusive 12 through 16 day periods qualify, including as-of equality", () => {
  for (const days of [11, 12, 14, 16, 17]) {
    const input = fixture();
    input.asOf = "2026-10-31";
    input.context.sessions.forEach((row) => {
      row.end = `2026-10-${days}`;
    });
    assert.equal(
      evaluateCompletedGoal(input).status,
      days >= 12 && days <= 16 ? "met" : "insufficient",
    );
  }
});

test("latest complete period wins over an older achievement and future counts", () => {
  const input = fixture();
  const older = input.context.sessions.map((row) => ({
    ...row,
    start: "2026-09-17",
    end: "2026-09-30",
    completed: 100,
  }));
  const future = input.context.sessions.map((row) => ({
    ...row,
    start: "2026-10-15",
    end: "2026-10-28",
    completed: 100,
  }));
  input.context.sessions.forEach((row) => {
    row.completed = 0;
  });
  input.context.sessions.push(...older, ...future);
  const before = structuredClone(input);
  const result = evaluateCompletedGoal(input);
  assert.equal(result.status, "waiting");
  assert.equal(result.value, 0);
  assert.equal(result.date, "2026-10-14");
  assert.deepEqual(input, before);
});

test("future starters do not require evidence before their active date", () => {
  const input = fixture();
  input.workspace.clinicians.push({
    clinicianId: 2,
    start: "2026-10-15",
    end: null,
    status: "active",
  } as CompletedGoalInput["workspace"]["clinicians"][number]);
  input.context.sessions = [input.context.sessions[0]];
  input.goal!.amount = 60;
  assert.equal(evaluateCompletedGoal(input).status, "met");
});

test("missing and nonfinite financial metrics cannot pass with a high forecast", () => {
  const input = fixture();
  input.goal = { metric: "profit", amount: 100, basis: "monthly" };
  for (const profit of [null, undefined, NaN, Infinity]) {
    input.financialObservations = [
      {
        start: "2026-10-01",
        end: "2026-10-14",
        source: "actual",
        values: { profit },
      },
    ];
    assert.equal(evaluateCompletedGoal(input).status, "insufficient");
  }
});

test("overlapping actual financial ranges cannot establish achievement", () => {
  const input = fixture();
  input.goal = { metric: "profit", amount: 100, basis: "monthly" };
  input.asOf = "2026-10-31";
  const actual = {
    start: "2026-10-01",
    end: "2026-10-14",
    source: "actual" as const,
    basis: "period" as const,
    values: { profit: 1000 },
  };
  for (const range of [
    { start: "2026-10-08", end: "2026-10-21" },
    { start: "2026-10-01", end: "2026-10-14" },
    { start: "2026-10-14", end: "2026-10-27" },
    { start: "2026-10-05", end: "2026-10-05" },
    { start: "2026-10-01", end: "2026-10-31" },
  ]) {
    input.financialObservations = [actual, { ...actual, ...range }];
    const result = evaluateCompletedGoal(input);
    assert.equal(result.status, "insufficient", JSON.stringify(range));
    assert.equal(result.value, null);
  }
});

test("adjacent financial periods remain eligible and preserve exact period amounts", () => {
  const input = fixture();
  input.goal = { metric: "profit", amount: 100, basis: "monthly" };
  input.asOf = "2026-10-28";
  input.financialObservations = [
    {
      start: "2026-10-01",
      end: "2026-10-14",
      source: "actual",
      basis: "period",
      values: { profit: 1000 },
    },
    {
      start: "2026-10-15",
      end: "2026-10-28",
      source: "actual",
      basis: "period",
      values: { profit: 10 },
    },
    {
      start: "2026-10-08",
      end: "2026-10-21",
      source: "budget",
      values: { profit: 10000 },
    },
    {
      start: "2026-10-22",
      end: "2026-11-04",
      source: "actual",
      values: { profit: 10000 },
    },
  ];
  const result = evaluateCompletedGoal(input);
  assert.equal(result.status, "waiting");
  assert.equal(result.date, "2026-10-28");
  assert.equal(result.value, (10 / 14) * 30.4375);
});

function dailyFixture(): CompletedGoalInput {
  const input = fixture();
  input.expected = 0;
  input.context.sessions = input.context.clinicians.flatMap((person) =>
    Array.from({ length: 14 }, (_, index) => {
      const date = `2026-10-${String(index + 1).padStart(2, "0")}`;
      return { clinicianId: person.id, start: date, end: date, completed: 10 };
    }),
  );
  return input;
}

test("fully covered daily imported facts establish a completed 14-day session period", () => {
  const input = dailyFixture();
  const result = evaluateCompletedGoal(input);
  assert.equal(result.status, "met");
  assert.equal(result.periodStart, "2026-10-01");
  assert.equal(result.date, "2026-10-14");
  assert.equal(result.value, 20 * 30.4375);
  // A known data boundary remains usable after the period has ended.
  input.asOf = "2026-10-20";
  assert.equal(evaluateCompletedGoal(input).status, "met");
  assert.equal(evaluateCompletedGoal(input).date, "2026-10-14");
});

test("daily imports require explicit zero facts and every selected clinician's active days", () => {
  const input = dailyFixture();
  input.context.sessions[3].completed = 0;
  assert.equal(evaluateCompletedGoal(input).status, "met");
  input.context.sessions.splice(3, 1);
  assert.equal(evaluateCompletedGoal(input).status, "insufficient");
  const missingClinician = dailyFixture();
  missingClinician.context.sessions = missingClinician.context.sessions.filter(
    (row) => row.clinicianId === 1,
  );
  assert.equal(evaluateCompletedGoal(missingClinician).status, "insufficient");
});

test("daily imports cannot use future days or overlapping duplicate facts", () => {
  const input = dailyFixture();
  input.asOf = "2026-10-13";
  assert.notEqual(evaluateCompletedGoal(input).status, "met");
  input.asOf = "2026-10-14";
  input.context.sessions.push({ ...input.context.sessions[0] });
  assert.equal(evaluateCompletedGoal(input).status, "insufficient");
});

test("daily block selection uses the latest complete block, including explicit zeros", () => {
  const input = dailyFixture();
  input.asOf = "2026-10-28";
  input.expected = 1000;
  input.context.sessions.push(
    ...input.context.clinicians.flatMap((person) =>
      Array.from({ length: 14 }, (_, index) => {
        const date = `2026-10-${index + 15}`;
        return { clinicianId: person.id, start: date, end: date, completed: 0 };
      }),
    ),
  );
  const result = evaluateCompletedGoal(input);
  assert.equal(result.status, "waiting");
  assert.equal(result.periodStart, "2026-10-15");
  assert.equal(result.date, "2026-10-28");
  assert.equal(result.value, 0);
});

test("daily blocks honor a clinician's partial-period active start", () => {
  const input = dailyFixture();
  input.workspace.clinicians.push({
    clinicianId: 2,
    start: "2026-10-08",
    end: null,
    status: "active",
  } as CompletedGoalInput["workspace"]["clinicians"][number]);
  input.context.sessions = input.context.sessions.filter(
    (row) => row.clinicianId !== 2 || row.start >= "2026-10-08",
  );
  assert.equal(evaluateCompletedGoal(input).status, "met");
  input.context.sessions = input.context.sessions.filter(
    (row) => row.clinicianId !== 2 || row.start !== "2026-10-08",
  );
  assert.equal(evaluateCompletedGoal(input).status, "insufficient");
});

test("older and newer partial-team imports preserve the previously completed daily window", () => {
  const input = fixture();
  input.goal!.amount = 10;
  input.expected = 0;
  const context: Context = {
    staff: [],
    sessions: [],
    clinicians: [1, 2].map((id) => ({
      id,
      label: `Clinician ${id}`,
      goalId: null,
      classification: "1099",
      sessionRate: 150,
      sessionsPerWeek: 20,
      weeksWorkedPerYear: 48,
      capEnabled: false,
      capAmount: 0,
      preCapClinicianSplit: 60,
      preCapPracticeSplit: 40,
      postCapClinicianSplit: 60,
      postCapPracticeSplit: 40,
      w2EmployerFicaPct: 0,
      futaSutaPct: 0,
      workersCompPct: 0,
      otherEmployerBurdenPct: 0,
    })),
  };
  const rows = context.clinicians.flatMap((person) =>
    Array.from({ length: 14 }, (_, index) => ({
      clientId: `client-${person.id}`,
      clinician: person.label,
      serviceDate: `2026-10-${String(index + 1).padStart(2, "0")}`,
      location: "Room A",
      status: "show",
      sourceRowHash: `${person.id}-${index}`,
    })),
  );
  const snapshot: Extract<LocalSnapshot, { kind: "attendance" }> = {
    id: "completed-goal-import",
    kind: "attendance",
    importedAt: "2026-10-15T12:00:00Z",
    coverageStart: "2026-10-01",
    coverageEnd: "2026-10-14",
    sourceHash: "goal-import",
    rows,
  };
  input.context = buildImportedSessionOverlay(
    context,
    [snapshot],
    null,
  ).context;
  const before = evaluateCompletedGoal(input);
  assert.equal(before.status, "met");
  assert.equal(before.value, 60.875);
  rows.push({
    clientId: "client-1",
    clinician: "Clinician 1",
    serviceDate: "2026-10-15",
    location: "Room A",
    status: "show",
    sourceRowHash: "1-new",
  });
  input.context = buildImportedSessionOverlay(
    context,
    [{ ...snapshot, coverageEnd: "2026-10-15" }],
    null,
  ).context;
  input.asOf = "2026-10-15";
  assert.deepEqual(evaluateCompletedGoal(input), before);
  assert.equal(input.context.sessions.length, 29);
  assert.equal(
    input.context.sessions.reduce((sum, row) => sum + row.completed, 0),
    29,
  );
  rows.push({
    clientId: "client-1",
    clinician: "Clinician 1",
    serviceDate: "2026-09-30",
    location: "Room A",
    status: "show",
    sourceRowHash: "1-older",
  });
  input.context = buildImportedSessionOverlay(
    context,
    [{ ...snapshot, coverageStart: "2026-09-30", coverageEnd: "2026-10-15" }],
    null,
  ).context;
  assert.deepEqual(evaluateCompletedGoal(input), before);
  assert.equal(input.context.sessions.length, 30);
  assert.equal(
    input.context.sessions.reduce((sum, row) => sum + row.completed, 0),
    30,
  );
});

test("headcount uses one dated clinician, not 100 sessions or an annual amount divided by 12", () => {
  const input = fixture();
  input.context.clinicians = [input.context.clinicians[0]];
  input.context.sessions = [{ ...input.context.sessions[0], completed: 100 }];
  input.workspace.clinicians.push({
    clinicianId: 1,
    start: "2026-10-01",
    end: null,
    status: "active",
  } as CompletedGoalInput["workspace"]["clinicians"][number]);
  input.goal = {
    metric: "activeClinicalHeadcount",
    amount: 10,
    basis: "annual",
  };
  const result = evaluateCompletedGoal(input);
  assert.equal(result.status, "waiting");
  assert.equal(result.value, 1);
  assert.equal(result.target, 10);
});

test("headcount needs full-team actual coverage and explicit active dates", () => {
  const input = fixture();
  input.goal = {
    metric: "activeClinicalHeadcount",
    amount: 1,
    basis: "monthly",
  };
  assert.equal(evaluateCompletedGoal(input).status, "insufficient");
  input.workspace.clinicians = input.context.clinicians.map(
    (person) =>
      ({
        clinicianId: person.id,
        start: "2026-10-01",
        end: null,
        status: "active",
      }) as CompletedGoalInput["workspace"]["clinicians"][number],
  );
  input.context.sessions.pop();
  assert.equal(evaluateCompletedGoal(input).status, "insufficient");
});

test("headcount counts the selected active clinical team at period end, including the owner", () => {
  const input = fixture();
  input.goal = {
    metric: "activeClinicalHeadcount",
    amount: 2,
    basis: "monthly",
  };
  input.workspace.clinicians = input.context.clinicians.map(
    (person) =>
      ({
        clinicianId: person.id,
        start: "2026-10-01",
        end: null,
        status: "active",
      }) as CompletedGoalInput["workspace"]["clinicians"][number],
  );
  input.context.clinicians[0].roleType = "owner";
  input.context.clinicians.push({ id: 3, goalId: 7 });
  assert.equal(evaluateCompletedGoal(input).status, "met");
  assert.equal(evaluateCompletedGoal(input).value, 2);
  input.workspace.clinicians[1].end = "2026-10-07";
  input.context.sessions[1].end = "2026-10-07";
  assert.equal(evaluateCompletedGoal(input).value, 1);
  assert.equal(evaluateCompletedGoal(input).status, "waiting");
});

test("owner distribution and co-owner salary goals use independent matching pre-tax actuals", () => {
  const input = fixture();
  input.financialObservations = [
    {
      start: "2026-10-01",
      end: "2026-10-14",
      source: "actual",
      basis: "period",
      values: {
        ownerDistributionsPretax: 100,
        coOwnerSalaryPretax: 10,
        familyTakeHome: 10000,
      },
    },
  ];
  input.goal = {
    metric: "ownerDistributionsPretax",
    amount: 100,
    basis: "monthly",
  };
  assert.equal(evaluateCompletedGoal(input).status, "met");
  input.goal.metric = "coOwnerSalaryPretax";
  assert.equal(evaluateCompletedGoal(input).status, "waiting");
  assert.equal(evaluateCompletedGoal(input).value, (10 / 14) * 30.4375);
  input.financialObservations[0].values.ownerDistributionsPretax = 10;
  input.financialObservations[0].values.coOwnerSalaryPretax = 100;
  assert.equal(evaluateCompletedGoal(input).status, "met");
  input.goal.metric = "ownerDistributionsPretax";
  assert.equal(evaluateCompletedGoal(input).status, "waiting");
});

test("unknown individual pre-tax actuals are insufficient despite household income or forecast", () => {
  const input = fixture();
  input.expected = 10000;
  input.financialObservations = [
    {
      start: "2026-10-01",
      end: "2026-10-14",
      source: "actual",
      basis: "period",
      values: { familyTakeHome: 10000, ownerDistributionsPretax: null },
    },
  ];
  for (const metric of [
    "ownerDistributionsPretax",
    "coOwnerSalaryPretax",
  ] as const) {
    input.goal = { metric, amount: 100, basis: "monthly" };
    assert.equal(evaluateCompletedGoal(input).status, "insufficient");
    assert.equal(evaluateCompletedGoal(input).value, null);
  }
});
