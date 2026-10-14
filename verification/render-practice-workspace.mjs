import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const playwrightRequire = createRequire(
  "/tmp/local-retention-browser-harness/package.json",
);
const { chromium } = playwrightRequire("playwright");

const browserPath =
  "/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const outDir = path.resolve("verification/practice-workspace-render");
await fs.mkdir(outDir, { recursive: true });

const uuid = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const today = "2026-10-14";
const workspace = {
  settings: {
    practiceName: "EMCounseling",
    teamId: 1,
    forecastStart: "2026-10-01",
    horizonMonths: 12,
    baselineMode: "manual",
    baselineWeeklySessions: 42,
    baselineRetentionPct: 92,
    historicalStart: "2026-01-01",
    historicalEnd: today,
    attendancePct: 90,
    attendanceMode: "manual",
    collectionPct: 100,
    processingPct: 3.15,
    processingFixedPerTransaction: 0.3,
    processingTransactionsPerSession: 1,
    processingOpeningTransactions: 0,
    overheadFloorMonthly: 12000,
    overheadFloorOverride: true,
    overheadMode: "baseline",
    collectionDelayMonths: 0,
    openingReceivables: 0,
    openingCash: 50000,
    minimumCash: 20000,
    organicClientsPerMonth: 5,
    retentionMonths: 6,
    sessionsPerClientMonth: 2,
    ownerPayrollMonthly: 0,
    ownerPayrollOverride: true,
    ownerPayrollBurdenPct: 0,
    familyW2ClinicianId: 2,
    householdWithholdingPct: 0,
    estimatedIncomeTaxPct: 15,
    includeOwnerClinical: true,
    otherHouseholdIncome: 0,
    householdBenefitsCost: 0,
    taxPct: 15,
    reservePct: 10,
    distributionPct: 25,
    targetProfitMonthly: 18000,
    defaultInPersonPct: 85,
    weeksPerYear: 48,
    goalSearch: null,
  },
  categories: [
    {
      id: uuid("101"),
      name: "Operating expenses",
      archived: false,
      notes: "",
      sourceAttachmentId: null,
      parentId: null,
      kind: "expense",
      order: 0,
      tags: [],
    },
    {
      id: uuid("102"),
      name: "Marketing",
      archived: false,
      notes: "",
      sourceAttachmentId: null,
      parentId: null,
      kind: "marketing",
      order: 1,
      tags: [],
    },
  ],
  budgets: [
    {
      id: uuid("201"),
      name: "Rent and utilities",
      archived: false,
      notes: "",
      sourceAttachmentId: null,
      planningOnly: false,
      start: "2026-01-01",
      end: null,
      billingDay: 5,
      billingReferenceStart: null,
      categoryId: uuid("101"),
      amount: 8500,
      cadence: "monthly",
      status: "budget",
      locationId: null,
      roomId: null,
      campaignId: null,
      clinicianId: null,
    },
  ],
  locations: [],
  rooms: [
    {
      id: uuid("301"),
      name: "Room 1",
      archived: false,
      notes: "",
      sourceAttachmentId: null,
      planningOnly: false,
      start: "2026-01-01",
      end: null,
      locationId: null,
      weeklyHours: 40,
      sessionMinutes: 60,
      usablePct: 85,
      telehealthUsesRoom: false,
      usage: "shared",
      dedicatedClinicianId: null,
      assignments: [],
      skippedWeeks: [],
      blocks: [],
    },
  ],
  clinicians: [],
  terms: [
    {
      id: uuid("401"),
      clinicianId: 2,
      effectiveDate: "2026-01-01",
      sessionRate: null,
      clinicianSplit: null,
      capacity: null,
      payMode: "salary",
      payAmount: 96000,
      paidHoursPerWeek: null,
      expectedSessionRevenue: null,
      notes: "",
    },
  ],
  staffTerms: [],
  campaigns: [],
  funnels: [],
  transactions: [],
  familyPaychecks: [],
  periods: [],
  allocations: [
    {
      id: uuid("501"),
      name: "Building Fund",
      archived: false,
      notes: "",
      sourceAttachmentId: null,
      kind: "reserve",
      percent: 10,
      household: false,
      start: "2026-10-01",
      end: null,
    },
  ],
  hiring: [],
  events: [],
  goals: [
    {
      id: uuid("601"),
      name: "Owner pay",
      archived: false,
      notes: "",
      sourceAttachmentId: null,
      metric: "familyTakeHome",
      amount: 180000,
      date: "2026-12-31",
      basis: "annual",
    },
    {
      id: uuid("602"),
      name: "Business Profit",
      archived: false,
      notes: "",
      sourceAttachmentId: null,
      metric: "profit",
      amount: 20000,
      date: "2026-12-31",
      basis: "monthly",
    },
  ],
  fundGoals: [
    {
      id: uuid("701"),
      name: "Building Fund",
      archived: false,
      notes: "",
      sourceAttachmentId: null,
      amount: 50000,
      date: null,
      currentBalance: null,
      balanceDate: null,
    },
  ],
  proposals: [],
  kpis: [],
  rules: [],
};

const context = {
  clinicians: [
    {
      id: 1,
      label: "Elia",
      goalId: 1,
      sessionRate: 185,
      sessionsPerWeek: 18,
      weeksWorkedPerYear: 48,
      capEnabled: false,
      capAmount: 0,
      preCapClinicianSplit: 0,
      preCapPracticeSplit: 100,
      postCapClinicianSplit: 0,
      postCapPracticeSplit: 100,
      classification: "owner",
      w2EmployerFicaPct: 0,
      futaSutaPct: 0,
      workersCompPct: 0,
      otherEmployerBurdenPct: 0,
      nonClinicalHoursPerWeek: 0,
      nonClinicalHourlyRate: 0,
    },
    {
      id: 2,
      label: "Erin",
      goalId: 1,
      sessionRate: 170,
      sessionsPerWeek: 24,
      weeksWorkedPerYear: 48,
      capEnabled: false,
      capAmount: 0,
      preCapClinicianSplit: 55,
      preCapPracticeSplit: 45,
      postCapClinicianSplit: 55,
      postCapPracticeSplit: 45,
      classification: "w2",
      w2EmployerFicaPct: 7.65,
      futaSutaPct: 1,
      workersCompPct: 0.5,
      otherEmployerBurdenPct: 0,
      nonClinicalHoursPerWeek: 0,
      nonClinicalHourlyRate: 0,
    },
  ],
  staff: [],
  sessions: [
    {
      clinicianId: 1,
      start: "2026-09-18",
      end: "2026-10-01",
      completed: 34,
      desired: 36,
      cancelled: 1,
      noShow: 0,
      scheduled: 35,
      inPerson: 20,
      telehealth: 14,
      sourceAttachmentId: null,
    },
    {
      clinicianId: 2,
      start: "2026-09-18",
      end: "2026-10-01",
      completed: 45,
      desired: 48,
      cancelled: 2,
      noShow: 1,
      scheduled: 48,
      inPerson: 30,
      telehealth: 15,
      sourceAttachmentId: null,
    },
  ],
  importedBillingActuals: [],
};

context.sessions = context.sessions.map((record, index) => ({ ...record, id: index + 1, revision: 1, updatedAt: today + "T00:00:00.000Z" }));
workspace.goals.push({ id: uuid("901"), name: "Synthetic sessions target", metric: "sessions", amount: 100, basis: "monthly", date: null });
workspace.goals.push({ id: uuid("903"), name: "Desired Clinicians", metric: "sessions", amount: 10, basis: "annual", date: null });
workspace.goals.push({ id: uuid("904"), name: "Co-owner pay", metric: "familyTakeHome", amount: 96000, basis: "annual", date: null });
workspace.consultAttributionOverrides = [];
workspace.focusedPlanAdoptions = [];
workspace.fundGoals[0].currentBalance = 100;
workspace.fundGoals[0].balanceDate = "2026-01-15";
workspace.proposals.push({
  id: uuid("902"), name: "Synthetic focused plan", status: "draft", changes: [],
  baseline: { kind: "practice-goal-v1", savedAt: today + "T00:00:00.000Z", sourceRevision: 1, workspace: { ...structuredClone(workspace), proposals: [] }, context: structuredClone(context) },
});
const attendance = (clientId, clinician, serviceDate, phone = false) => ({
  clientId, clinician, serviceDate, location: null, status: "show", billingCode: phone ? "PHONE" : "90837", visitKind: phone ? "consultation" : "treatment", sourceRowHash: `${clientId}-${clinician}-${serviceDate}`,
});
const snapshots = [{ id: "synthetic-attendance", kind: "attendance", importedAt: today + "T00:00:00.000Z", coverageStart: "2026-01-01", coverageEnd: today, sourceHash: "synthetic-only", rows: [
  attendance("converted", "Elia", "2026-01-02", true), attendance("converted", "Erin", "2026-01-08"),
  attendance("mature-miss", "Elia", "2026-01-03", true),
  attendance("ended", "Erin", "2026-06-01"), attendance("ended", "Erin", "2026-06-08"), attendance("ended", "Erin", "2026-06-15"),
] }];

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const browserErrors = [];
page.on("pageerror", (error) => browserErrors.push(error.message));
let revision = 1;
let importReads = 0;

await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === "/api/hub" && ["POST", "PUT"].includes(route.request().method())) {
    Object.assign(workspace, route.request().postDataJSON().data);
    revision++;
  }
  if (url.pathname === "/api/practice-imports") importReads++;
  const body =
    url.pathname === "/api/hub"
      ? { revision, data: workspace, updatedAt: "2026-10-14T00:00:00.000Z" }
      : url.pathname === "/api/hub/context"
        ? context
        : url.pathname === "/api/practice-imports"
          ? { snapshots, billingCodeMinutes: {}, sameDayVisitOverrides: {}, packages: [] }
        : url.pathname === "/api/business-goals"
          ? [{ id: 1, name: "Whole Practice" }]
          : url.pathname.startsWith("/api/session-goals")
            ? []
            : { ok: true };
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
});

const checks = [];
async function capture(name, width, height, clickText) {
  await page.setViewportSize({ width, height });
  if (clickText) await page.getByRole("button", { name: clickText }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    path: path.join(outDir, `${name}-${width}.png`),
    fullPage: true,
  });
  const metrics = await page.evaluate(() => ({
    url: location.pathname,
    title: document.querySelector("h1")?.textContent,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    buttonCount: document.querySelectorAll("button").length,
    text: document.body.innerText.slice(0, 2000),
  }));
  checks.push({ name, width, height, ...metrics });
}

async function clickSection(name) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const practiceNav = page.locator('nav[aria-label="Practice sections"]');
  if (!(await practiceNav.count())) {
    await page.getByRole("button", { name: "Today", exact: true }).click();
  }
  await page
    .locator('nav[aria-label="Practice sections"] button', { hasText: name })
    .first()
    .click();
}

await page.goto("http://127.0.0.1:4317/workspace");
await capture("overview-desktop", 1280, 900);
await capture("overview-mobile", 390, 900);
assert.ok(importReads > 0, "saved imports load on fresh Today view");
assert.ok(await page.getByText("Synthetic sessions target goal met", { exact: true }).count(), "Overview includes completed actual achievement");
assert.equal(await page.getByText("Desired Clinicians goal met", { exact: true }).count(), 0, "sessions cannot meet a headcount target");
assert.equal(await page.getByLabel("Overview financial summary", { exact: true }).count(), 1);
assert.equal(await page.getByLabel("Overview combined funding progress", { exact: true }).count(), 1);
assert.equal(await page.getByLabel("Overview client growth", { exact: true }).count(), 1);
assert.equal(await page.locator(".pw-overview-existing-details").getAttribute("open"), null, "old detailed views stay collapsed");
await clickSection("Sessions");
await capture("sessions-desktop", 1280, 900);
await capture("sessions-mobile", 390, 900);
await page.getByRole("button", { name: "Elia", exact: true }).click();
await page.getByRole("button", { name: "Compare with Whole Practice", exact: true }).click();
assert.ok(await page.getByText(/Whole practice:.*completed \/ week/).count(), "Compare renders practice evidence");
await capture("sessions-compare-desktop", 1280, 900);
await page.getByLabel("Shared reporting period", { exact: true }).selectOption("custom");
await page.getByLabel("From", { exact: true }).fill("2026-02-01");
await page.getByLabel("Through", { exact: true }).fill("2026-02-28");
assert.ok(await page.getByText("No complete recorded periods in this date range.", { exact: true }).count(), "selected bounds filter Sessions evidence");
await page.getByLabel("Shared reporting period", { exact: true }).selectOption("overall");
await page.getByRole("tab", { name: "Attrition", exact: true }).click();
await page.getByRole("button", { name: "Erin", exact: true }).click();
await page.getByRole("button", { name: "Compare with Whole Practice", exact: true }).click();
assert.match(await page.getByLabel("Whole Practice comparison", { exact: true }).innerText(), /1 unique client endings \/ 6 mature months/, "attrition benchmark uses unique mature 90-day endings");
await capture("attrition-compare-mobile", 390, 900);
await clickSection("Growth");
await capture("growth-desktop", 1280, 900);
await capture("growth-mobile", 390, 900);
await page.getByRole("tab", { name: "Lead flow", exact: true }).click();
await page.getByLabel("Shared reporting period", { exact: true }).selectOption("overall");
assert.match(await page.locator(".pw-metric-hero").innerText(), /50%/, "mature unresolved miss remains in practice conversion denominator");
await page.getByText("Review client attribution candidates", { exact: true }).click();
await page.getByLabel("Confirmed owner for converted", { exact: true }).selectOption("Erin");
await page.getByRole("button", { name: "Confirm closer", exact: true }).first().click();
await capture("consult-attribution-mobile", 390, 900);
await page.getByRole("button", { name: "Review changes", exact: true }).click();
await page.getByRole("button", { name: "Save changes", exact: true }).click();
await page.waitForLoadState("networkidle");
assert.equal(workspace.consultAttributionOverrides[0].clinicianName, "Erin", "manual closer is persisted");
await clickSection("Growth");
await page.getByRole("tab", { name: "Rooms", exact: true }).click();
await capture("rooms-desktop", 1280, 900);
await capture("rooms-mobile", 390, 900);
await clickSection("Money");
await capture("money-desktop", 1280, 900);
await capture("money-mobile", 390, 900);
await clickSection("Goals");
await capture("goals-desktop", 1280, 900);
await capture("goals-mobile", 390, 900);
const headcountGoal = page.locator(".pw-edit-item", { has: page.getByRole("heading", { name: "Desired Clinicians", exact: true }) });
assert.match(await headcountGoal.innerText(), /Active clinical headcount\s+2/, "headcount progress shows people");
await headcountGoal.getByLabel("Goal amount", { exact: true }).fill("11");
await headcountGoal.getByLabel("Goal amount", { exact: true }).blur();
await page.getByRole("button", { name: "Review changes", exact: true }).click();
await page.getByRole("button", { name: "Save changes", exact: true }).click();
await page.waitForLoadState("networkidle");
assert.equal(workspace.goals.find((goal) => goal.name === "Desired Clinicians").metric, "activeClinicalHeadcount", "editing persists corrected goal binding");
await clickSection("Team");
await capture("team-desktop", 1280, 900);
await capture("team-mobile", 390, 900);
assert.ok(!(await page.locator(".pw-person-kpis").allTextContents()).join(" ").includes("5000%"), "clinician percentage uses the stored percentage scale");
await page.setViewportSize({ width: 1280, height: 900 });
await page.getByRole("button", { name: /Long Term Goals/ }).click();
await capture("long-term-goals-desktop", 1280, 900);
await capture("long-term-goals-mobile", 390, 900);
await page.setViewportSize({ width: 1280, height: 900 });
await page.getByRole("button", { name: "Adopt plan", exact: true }).click();
await page.waitForLoadState("networkidle");
assert.equal(workspace.focusedPlanAdoptions.length, 1, "adoption uses focused persistence");
assert.ok(workspace.focusedPlanAdoptions[0].highlights.some((item) => item.includes("Sessions")), "adoption highlights follow selected Sessions focus");
assert.equal(workspace.proposals[0].approvedAt ?? null, null, "adoption preserves approval baseline");
await page.reload();
await clickSection("Overview");
assert.ok(await page.getByText(/Synthetic focused plan:/).count(), "saved focus survives reload into Overview");
assert.equal(await page.getByText(/New data or assumptions changed this plan/).count(), 0, "saving adoption alone does not invalidate focus");
assert.deepEqual(browserErrors, [], "no browser exceptions");

await fs.writeFile(
  path.join(outDir, "metrics.json"),
  JSON.stringify(checks, null, 2),
);
await browser.close();

for (const check of checks) {
  if (check.scrollWidth > check.clientWidth + 1) {
    throw new Error(
      `${check.name} overflows horizontally: ${check.scrollWidth} > ${check.clientWidth}`,
    );
  }
}
console.log(JSON.stringify({ outDir, checks }, null, 2));
