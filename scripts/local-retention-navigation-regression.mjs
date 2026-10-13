import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dashboardRoot = path.join(repoRoot, "artifacts/comp-dashboard");
const playwrightPackageDir =
  process.env.PLAYWRIGHT_PACKAGE_DIR ?? "/tmp/local-retention-browser-harness";

const dashboardRequire = createRequire(
  path.join(dashboardRoot, "package.json"),
);
const playwrightRequire = createRequire(
  path.join(playwrightPackageDir, "package.json"),
);

const { createServer } = await import(dashboardRequire.resolve("vite"));
const react = (await import(dashboardRequire.resolve("@vitejs/plugin-react")))
  .default;
const { chromium } = playwrightRequire("playwright");

const browserExecutableCandidates = [
  process.env.PLAYWRIGHT_BROWSER_EXECUTABLE_PATH,
  "/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const browserExecutablePath = browserExecutableCandidates.find((candidate) =>
  existsSync(candidate),
);

if (!browserExecutablePath) {
  throw new Error(
    "No browser executable found. Set PLAYWRIGHT_BROWSER_EXECUTABLE_PATH or install Playwright browsers.",
  );
}

const syntheticAttendanceCsv = `Client,Clinician,Date of service,Location,Status
CID-nav-alpha,Dr Navigation,2026-10-01,Room Nav A,show
CID-nav-alpha,Dr Navigation,2026-10-15,Room Nav A,show
CID-nav-same,Dr Navigation,2026-10-01,Room Nav B,show
CID-nav-same,Dr Navigation,2026-10-01,Room Nav B,show
CID-nav-noshow,Dr Navigation,2026-10-02,Room Nav C,no show`;

const syntheticBillingCsv = `Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-01,CID-nav-alpha,Dr Navigation,150,90837
2026-10-20,CID-nav-billed-later,Dr Navigation,100,90837`;

const makeFile = (name, mimeType, text) => ({
  name,
  mimeType,
  buffer: Buffer.from(text),
});

const normalize = (value) => value.replace(/\s+/g, " ").trim();

async function importFile(page, inputIndex, file) {
  await page.locator("input[type=file]").nth(inputIndex).setInputFiles(file);
}

async function waitForBodyText(page, text) {
  await page.waitForFunction(
    (expected) => document.body.textContent?.includes(expected),
    text,
  );
}

async function summaryText(page) {
  return normalize(await page.locator(".pw-retention-summary").textContent());
}

async function tableText(page, heading) {
  const section = page.locator(".pw-local-tables section", {
    has: page.getByRole("heading", { name: heading }),
  });
  return normalize(await section.textContent());
}

async function navigateAwayAndBack(page) {
  await page.getByRole("button", { name: "Sessions" }).click();
  await page.waitForSelector('section[aria-label="Sessions placeholder"]');
  await page.getByRole("button", { name: "Retention" }).click();
  await page.waitForSelector('section[aria-label="Local retention workspace"]');
}

const server = await createServer({
  configFile: false,
  root: dashboardRoot,
  base: "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.join(dashboardRoot, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.LOCAL_RETENTION_NAVIGATION_PORT ?? 4398),
    strictPort: false,
    hmr: false,
    fs: {
      strict: true,
      allow: [dashboardRoot],
    },
  },
});

let browser;
try {
  await server.listen();
  const address = server.httpServer?.address();
  const port =
    typeof address === "object" && address
      ? address.port
      : server.config.server.port;
  const url = `http://127.0.0.1:${port}/test-harness/local-retention-navigation-harness.html`;

  browser = await chromium.launch({
    headless: true,
    executablePath: browserExecutablePath,
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector('section[aria-label="Local retention workspace"]');

  await importFile(
    page,
    0,
    makeFile("navigation-attendance.csv", "text/csv", syntheticAttendanceCsv),
  );
  await waitForBodyText(page, "Loaded 5 attendance rows");
  await importFile(
    page,
    1,
    makeFile("navigation-billing.csv", "text/csv", syntheticBillingCsv),
  );
  await waitForBodyText(page, "Loaded 2 billing rows");
  await page.getByLabel("Billing code").fill("90837");
  await page.getByLabel("Default minutes").fill("45");
  await page.getByRole("button", { name: "Add" }).click();

  const importedSummary = await summaryText(page);
  const importedAttendance = await tableText(page, "Attendance and retention");
  const importedBilling = await tableText(page, "Billing charged");
  assert.match(importedSummary, /Attendance rows\s*5/);
  assert.match(importedSummary, /Billed rows\s*2/);
  assert.match(importedAttendance, /Dr Navigation\s*4\s*0\s*1\s*0\s*2\s*1\s*1/);
  assert.match(importedBilling, /Dr Navigation\s*2\s*\$250\.00\s*2\s*1\.5/);

  await navigateAwayAndBack(page);
  assert.equal(await summaryText(page), importedSummary);
  assert.equal(
    await tableText(page, "Attendance and retention"),
    importedAttendance,
  );
  assert.equal(await tableText(page, "Billing charged"), importedBilling);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Download .*backup/ }).click(),
  ]);
  const downloadedPath = await download.path();
  assert.ok(downloadedPath, "Expected Playwright download path.");
  const backupText = await fs.readFile(downloadedPath, "utf8");

  await importFile(
    page,
    2,
    makeFile("navigation-restore.json", "application/json", backupText),
  );
  await waitForBodyText(page, "Restored 2 local snapshots from backup.");
  const restoredSummary = await summaryText(page);
  const restoredBilling = await tableText(page, "Billing charged");
  assert.equal(restoredSummary, importedSummary);
  assert.equal(restoredBilling, importedBilling);

  await navigateAwayAndBack(page);
  assert.equal(await summaryText(page), restoredSummary);
  assert.equal(await tableText(page, "Billing charged"), restoredBilling);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        url,
        browserExecutablePath,
        importedSummary,
        importedAttendance,
        importedBilling,
        downloadedBackupBytes: Buffer.byteLength(backupText),
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
