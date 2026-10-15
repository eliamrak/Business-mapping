import fs from "node:fs/promises";
const source = await fs.readFile(new URL("./render-practice-workspace.mjs", import.meta.url), "utf8");
const start = source.indexOf("await page.goto(new URL");
if (start < 0) throw new Error("Harness setup boundary changed");
const checksSource = String.raw`
workspace.periods = [
  { id: uuid("9101"), name: "Synthetic January actual", start: "2026-01-01", end: "2026-01-31", earnedRevenue: 1000 },
  { id: uuid("9102"), name: "Synthetic February actual", start: "2026-02-01", end: "2026-02-28", earnedRevenue: 2000 },
].map((period) => ({ ...period, status: "finalized", archived: false, notes: "", sourceAttachmentId: null, revenue: period.earnedRevenue, clinicianPay: 0, employerBurden: 0, staffPay: 0, ownerPay: 0, expensesComplete: true }));
const writes = [];
await page.route("**/api/**", async (route, request) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { writes.push(request.method() + " " + new URL(request.url()).pathname); return route.abort(); }
  return route.fallback();
});
try {
  await page.goto(new URL("/workspace", process.env.PRACTICE_PREVIEW_URL ?? "http://127.0.0.1:4318").href);
  await clickSection("Money");
  await page.getByLabel("Shared reporting period", { exact: true }).selectOption("custom");
  const bridge = page.locator("section", { has: page.getByRole("heading", { name: "Selected period money bridge", exact: true }) });
  const flow = page.getByLabel("Selected period money flow", { exact: true });
  const selectRange = async (from, through) => { await page.getByLabel("From", { exact: true }).fill(from); await page.getByLabel("Through", { exact: true }).fill(through); };
  await selectRange("2026-01-01", "2026-01-31");
  const january = { bridge: await bridge.innerText(), charges: await page.getByLabel("Reported charged fees", { exact: true }).innerText(), flow: await flow.innerText() };
  assert.match(january.bridge, /2026-01-01 to 2026-01-31/);
  assert.match(january.bridge, /\$1,000/);
  assert.match(january.charges, /\$33,035/);
  assert.match(january.flow, /\$1,000/);
  await capture("money-selected-january-desktop", 1280, 900);
  await capture("money-selected-january-mobile", 390, 900);
  await flow.screenshot({ path: path.join(outDir, "money-selected-january-flow-mobile.png") });
  await selectRange("2026-02-01", "2026-02-28");
  const february = { bridge: await bridge.innerText(), charges: await page.getByLabel("Reported charged fees", { exact: true }).innerText(), flow: await flow.innerText() };
  assert.match(february.bridge, /2026-02-01 to 2026-02-28/);
  assert.match(february.bridge, /\$2,000/);
  assert.match(february.charges, /\$31,370/);
  assert.match(february.flow, /\$2,000/);
  assert.notEqual(january.bridge, february.bridge);
  assert.notEqual(january.charges, february.charges);
  assert.equal(await flow.locator(".pw-flow-profit strong").innerText(), await bridge.locator(".pw-bridge-profit strong").innerText());
  await capture("money-selected-february-desktop", 1280, 900);
  await capture("money-selected-february-mobile", 390, 900);
  await clickSection("Overview");
  await page.getByLabel("Shared reporting period", { exact: true }).selectOption("year");
  const annual = await page.getByLabel("Overview financial summary", { exact: true }).innerText();
  assert.match(annual, /2026 current-year progress/);
  assert.match(annual, /2026-10-15 to 2026-12-31/);
  assert.match(annual, /Actual reported charged fees/);
  assert.match(annual, /finalized financial coverage incomplete/);
  assert.doesNotMatch(annual, /Next 12 months|2027/);
  await capture("current-year-split-desktop", 1280, 900);
  await capture("current-year-split-mobile", 390, 900);
  assert.ok(await page.getByLabel("Current year actual and forward split", { exact: true }).locator(".pw-overview-total strong").evaluateAll((nodes) => nodes.every((node) => { const box = node.getBoundingClientRect(), parent = node.parentElement.getBoundingClientRect(); return box.left >= parent.left - 1 && box.right <= parent.right + 1 && getComputedStyle(node).whiteSpace === "nowrap"; })), "mobile current-year monetary values stay within rows without splitting or clipping");
  await page.getByLabel("Overview financial summary", { exact: true }).screenshot({ path: path.join(outDir, "current-year-financial-summary-mobile.png") });
  assert.deepEqual(writes, []);
  assert.deepEqual(browserErrors, []);
  assert.ok(checks.every((check) => check.topNavigation && check.scrollWidth <= check.clientWidth + 1));
  const evidence = { syntheticOnly: true, productionAccess: false, january, february, annual, writes, browserErrors, checks };
  await fs.writeFile(path.join(outDir, "working-period-repair-results.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
`;
await import("data:text/javascript;base64," + Buffer.from(source.slice(0, start) + checksSource).toString("base64"));
