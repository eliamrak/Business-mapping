import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const source = await fs.readFile(repo + "/verification/render-practice-workspace.mjs", "utf8");
const start = source.indexOf("await page.goto(new URL");
if (start < 0) throw new Error("Candidate harness setup boundary changed");

const verification = String.raw`
// Aggregate-shaped reproduction; synthetic service dates and client identities.
const template = structuredClone(context.clinicians[0]);
const names = ["Elia", "Erin", "Jessica Cockrum", "Jessica Yates", "Michele", "Natalie"];
const desired = [15,16,20,5,23,15], rates = [150,185,150,150,175,175], counts = [66,73,34,12,104,62];
context.clinicians = names.map((label, index) => ({ ...template, id: index + 1, label, sessionsPerWeek: desired[index], sessionRate: rates[index], classification: index === 0 ? "owner" : "1099", preCapClinicianSplit: index === 0 ? 0 : 60, preCapPracticeSplit: index === 0 ? 100 : 40 }));
context.sessions = [];
context.staff = [];
Object.assign(workspace.settings, { practiceName: "Aggregate forecast regression (synthetic dates)", forecastStart: "2026-09-01", baselineMode: "historical", baselineRetentionPct: 100, organicClientsPerMonth: 0, defaultInPersonPct: 0, teamSelectionExplicit: true });
workspace.clinicians = []; workspace.terms = []; workspace.events = []; workspace.campaigns = []; workspace.rooms = []; workspace.proposals = [];
// All draft/null financial periods must not erase imported reported charges.
workspace.financialPeriods = Array.from({ length: 9 }, (_, index) => ({ id: uuid(String(8000 + index)), start: "2026-" + String(index + 1).padStart(2, "0") + "-01", end: "2026-" + String(index + 1).padStart(2, "0") + "-28", status: "draft", revenue: null, earnedRevenue: null }));
const billing = snapshots.find((snapshot) => snapshot.kind === "billing");
const rows = counts.flatMap((count, person) => Array.from({ length: count }, (_, index) => {
  const date = new Date(Date.parse("2026-08-20T12:00:00Z") + (index % 56) * 86400000).toISOString().slice(0, 10);
  return attendance("synthetic-person-" + person + "-" + index, names[person], date);
}));
snapshots.splice(0, snapshots.length, { id: "synthetic-observed-351", kind: "attendance", importedAt: today + "T00:00:00Z", coverageStart: "2026-08-20", coverageEnd: "2026-10-14", sourceHash: "synthetic-351", rows }, billing);
const writes = [];
await page.route("**/api/**", async (route, request) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { writes.push(request.method() + " " + new URL(request.url()).pathname); return route.abort(); }
  return route.fallback();
});
await page.goto(new URL("/workspace", process.env.PRACTICE_PREVIEW_URL ?? "http://127.0.0.1:4318").href);
await clickSection("Money");
const bridge = page.locator("section", { has: page.getByRole("heading", { name: "Projected money bridge", exact: true }) });
await page.waitForLoadState("networkidle");
assert.match(await bridge.innerText(), /Oct 2026 projection[\s\S]*\$32,857[\s\S]*Projected revenue/);
assert.doesNotMatch(await bridge.innerText(), /61,542|Billed revenue|Nov 2026 projection/);
const actual = page.getByLabel("Reported charged fees", { exact: true });
assert.match(await actual.innerText(), /\$32,323[\s\S]*\$32,744[\s\S]*\$11,440/);
assert.match(await page.locator(".pw-today-flow").innerText(), /\$32,857/);
await capture("revenue-repair-desktop", 1280, 900);
await page.screenshot({ path: path.join(outDir, "revenue-repair-desktop-top.png"), fullPage: false });
await capture("revenue-repair-mobile", 390, 900);
await page.screenshot({ path: path.join(outDir, "revenue-repair-mobile-top.png"), fullPage: false });
assert.ok(await bridge.locator(".pw-bridge-step strong").evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth + 1)));
assert.equal(checks.every((check) => check.scrollWidth <= check.clientWidth + 1 && check.topNavigation), true);
assert.deepEqual(writes, [], "read-only render makes no business or preference writes");
const report = { productionAccess: false, syntheticDates: true, observedVisits: rows.length, lookbackDays: 56, baselineWeekly: 351 / 8, projectedOctoberRevenue: 59355 * 31 / 56, reportedThreeMonthAverage: 96970 / 3, reportedNineMonthAverage: 294699 / 9, partialOctoberCharges: 11440, writes, browserErrors, checks };
assert.deepEqual(browserErrors, []);
await fs.writeFile(path.join(outDir, "revenue-repair-results.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
`;
await import("data:text/javascript;base64," + Buffer.from(source.slice(0, start) + verification + "\n//# sourceURL=revenue-repair-check.mjs").toString("base64"));
