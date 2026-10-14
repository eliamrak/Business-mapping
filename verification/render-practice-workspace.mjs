import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

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

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  const body =
    url.pathname === "/api/hub"
      ? { revision: 1, data: workspace, updatedAt: "2026-10-14T00:00:00.000Z" }
      : url.pathname === "/api/hub/context"
        ? context
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
await clickSection("Sessions");
await capture("sessions-desktop", 1280, 900);
await capture("sessions-mobile", 390, 900);
await clickSection("Growth");
await capture("growth-desktop", 1280, 900);
await capture("growth-mobile", 390, 900);
await clickSection("Growth");
await page.locator("button", { hasText: "Rooms" }).first().click();
await capture("rooms-desktop", 1280, 900);
await capture("rooms-mobile", 390, 900);
await clickSection("Money");
await capture("money-desktop", 1280, 900);
await capture("money-mobile", 390, 900);
await clickSection("Goals");
await capture("goals-desktop", 1280, 900);
await capture("goals-mobile", 390, 900);
await clickSection("Team");
await capture("team-desktop", 1280, 900);
await capture("team-mobile", 390, 900);
await page.setViewportSize({ width: 1280, height: 900 });
await page.getByRole("button", { name: "Long Term Goals", exact: true }).click();
await capture("long-term-goals-desktop", 1280, 900);
await capture("long-term-goals-mobile", 390, 900);

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
