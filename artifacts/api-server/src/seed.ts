import { db } from "@workspace/db";
import {
  businessGoalsTable,
  currentRealityTable,
  cliniciansTable,
  scenariosTable,
  scenarioCliniciansTable,
} from "@workspace/db";
import { logger } from "./lib/logger";

export async function seedIfEmpty() {
  const existingGoals = await db.select().from(businessGoalsTable).limit(1);
  if (existingGoals.length > 0) return;

  logger.info("Seeding demo data...");

  // Business Goals
  const [goal1] = await db.insert(businessGoalsTable).values({
    name: "Year 1 Baseline",
    timeHorizon: "1year",
    ownerPayGoal: "120000",
    secondOwnerPayGoal: "80000",
    annualOverheadGoal: "150000",
    businessProfitGoal: "50000",
    buildingFundGoal: "20000",
    emergencyReserveGoal: "30000",
    growthFundGoal: "25000",
    desiredCliniciansCount: 6,
    desiredOwnerClinicalCaseload: 10,
    notes: "Primary growth target for the first year.",
  }).returning();

  await db.insert(businessGoalsTable).values({
    name: "3-Year Expansion",
    timeHorizon: "3year",
    ownerPayGoal: "180000",
    secondOwnerPayGoal: "120000",
    annualOverheadGoal: "220000",
    businessProfitGoal: "100000",
    buildingFundGoal: "50000",
    emergencyReserveGoal: "60000",
    growthFundGoal: "75000",
    desiredCliniciansCount: 10,
    desiredOwnerClinicalCaseload: 5,
    notes: "Three-year growth scenario with expanded team.",
  }).returning();

  // Current Reality
  await db.insert(currentRealityTable).values({
    currentOwnerPay: "85000",
    currentSecondOwnerPay: "55000",
    currentAnnualOverhead: "95000",
    currentBusinessProfit: "20000",
    currentCashReserve: "40000",
    currentBuildingFund: "5000",
    currentCliniciansCount: 3,
    currentAvgSessionRate: "165",
    currentAvgSessionsPerWeek: "18",
    currentAvgWeeksWorkedPerYear: "46",
  });

  // Clinician profiles
  const [clinicianA] = await db.insert(cliniciansTable).values({
    label: "Clinician A",
    roleType: "associate",
    classification: "w2",
    sessionRate: "175",
    sessionsPerWeek: "20",
    weeksWorkedPerYear: "48",
    preCapClinicianSplit: "60",
    preCapPracticeSplit: "40",
    capEnabled: true,
    capAmount: "50000",
    postCapClinicianSplit: "75",
    postCapPracticeSplit: "25",
    w2EmployerFicaPct: "7.65",
    futaSutaPct: "1.0",
    workersCompPct: "0.5",
    otherEmployerBurdenPct: "0",
    notes: "Senior associate, full-time W2.",
  }).returning();

  const [clinicianB] = await db.insert(cliniciansTable).values({
    label: "Clinician B",
    roleType: "contractor",
    classification: "1099",
    sessionRate: "175",
    sessionsPerWeek: "15",
    weeksWorkedPerYear: "48",
    preCapClinicianSplit: "60",
    preCapPracticeSplit: "40",
    capEnabled: true,
    capAmount: "50000",
    postCapClinicianSplit: "95",
    postCapPracticeSplit: "5",
    w2EmployerFicaPct: "7.65",
    futaSutaPct: "1.0",
    workersCompPct: "0.5",
    otherEmployerBurdenPct: "0",
    notes: "Independent contractor, 1099.",
  }).returning();

  const [practiceOwner] = await db.insert(cliniciansTable).values({
    label: "Practice Owner",
    roleType: "owner",
    classification: "owner",
    sessionRate: "175",
    sessionsPerWeek: "10",
    weeksWorkedPerYear: "48",
    preCapClinicianSplit: "100",
    preCapPracticeSplit: "0",
    capEnabled: false,
    capAmount: "50000",
    postCapClinicianSplit: "100",
    postCapPracticeSplit: "0",
    w2EmployerFicaPct: "7.65",
    futaSutaPct: "1.0",
    workersCompPct: "0.5",
    otherEmployerBurdenPct: "0",
    notes: "Owner draw — not included in practice net calc.",
  }).returning();

  // Scenario 1: W2 Team
  const [scenario1] = await db.insert(scenariosTable).values({
    name: "Scenario 1 — W2 Team",
    notes: "All clinicians on W2 classification with standard splits.",
    businessGoalId: goal1.id,
  }).returning();

  await db.insert(scenarioCliniciansTable).values([
    {
      scenarioId: scenario1.id,
      sourceClinicianId: clinicianA.id,
      label: "Clinician A",
      roleType: "associate",
      classification: "w2",
      sessionRate: "175",
      sessionsPerWeek: "20",
      weeksWorkedPerYear: "48",
      preCapClinicianSplit: "60",
      preCapPracticeSplit: "40",
      capEnabled: true,
      capAmount: "50000",
      postCapClinicianSplit: "75",
      postCapPracticeSplit: "25",
      w2EmployerFicaPct: "7.65",
      futaSutaPct: "1.0",
      workersCompPct: "0.5",
      otherEmployerBurdenPct: "0",
    },
    {
      scenarioId: scenario1.id,
      sourceClinicianId: clinicianB.id,
      label: "Clinician B (W2)",
      roleType: "associate",
      classification: "w2",
      sessionRate: "175",
      sessionsPerWeek: "15",
      weeksWorkedPerYear: "48",
      preCapClinicianSplit: "60",
      preCapPracticeSplit: "40",
      capEnabled: true,
      capAmount: "50000",
      postCapClinicianSplit: "75",
      postCapPracticeSplit: "25",
      w2EmployerFicaPct: "7.65",
      futaSutaPct: "1.0",
      workersCompPct: "0.5",
      otherEmployerBurdenPct: "0",
    },
    {
      scenarioId: scenario1.id,
      sourceClinicianId: practiceOwner.id,
      label: "Practice Owner",
      roleType: "owner",
      classification: "owner",
      sessionRate: "175",
      sessionsPerWeek: "10",
      weeksWorkedPerYear: "48",
      preCapClinicianSplit: "100",
      preCapPracticeSplit: "0",
      capEnabled: false,
      capAmount: "50000",
      postCapClinicianSplit: "100",
      postCapPracticeSplit: "0",
      w2EmployerFicaPct: "7.65",
      futaSutaPct: "1.0",
      workersCompPct: "0.5",
      otherEmployerBurdenPct: "0",
    },
  ]);

  // Scenario 2: Mixed W2 / 1099
  const [scenario2] = await db.insert(scenariosTable).values({
    name: "Scenario 2 — Mixed W2 / 1099",
    notes: "Compare same production with different classifications. Clinician A on W2, Clinician B on 1099.",
    businessGoalId: goal1.id,
  }).returning();

  await db.insert(scenarioCliniciansTable).values([
    {
      scenarioId: scenario2.id,
      sourceClinicianId: clinicianA.id,
      label: "Clinician A (W2)",
      roleType: "associate",
      classification: "w2",
      sessionRate: "175",
      sessionsPerWeek: "20",
      weeksWorkedPerYear: "48",
      preCapClinicianSplit: "60",
      preCapPracticeSplit: "40",
      capEnabled: true,
      capAmount: "50000",
      postCapClinicianSplit: "75",
      postCapPracticeSplit: "25",
      w2EmployerFicaPct: "7.65",
      futaSutaPct: "1.0",
      workersCompPct: "0.5",
      otherEmployerBurdenPct: "0",
    },
    {
      scenarioId: scenario2.id,
      sourceClinicianId: clinicianB.id,
      label: "Clinician B (1099)",
      roleType: "contractor",
      classification: "1099",
      sessionRate: "175",
      sessionsPerWeek: "15",
      weeksWorkedPerYear: "48",
      preCapClinicianSplit: "60",
      preCapPracticeSplit: "40",
      capEnabled: true,
      capAmount: "50000",
      postCapClinicianSplit: "95",
      postCapPracticeSplit: "5",
      w2EmployerFicaPct: "7.65",
      futaSutaPct: "1.0",
      workersCompPct: "0.5",
      otherEmployerBurdenPct: "0",
    },
    {
      scenarioId: scenario2.id,
      sourceClinicianId: practiceOwner.id,
      label: "Practice Owner",
      roleType: "owner",
      classification: "owner",
      sessionRate: "175",
      sessionsPerWeek: "10",
      weeksWorkedPerYear: "48",
      preCapClinicianSplit: "100",
      preCapPracticeSplit: "0",
      capEnabled: false,
      capAmount: "50000",
      postCapClinicianSplit: "100",
      postCapPracticeSplit: "0",
      w2EmployerFicaPct: "7.65",
      futaSutaPct: "1.0",
      workersCompPct: "0.5",
      otherEmployerBurdenPct: "0",
    },
  ]);

  logger.info("Demo data seeded successfully.");
}
