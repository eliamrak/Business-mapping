import fs from "node:fs/promises";
const source = await fs.readFile(new URL("./render-practice-workspace.mjs", import.meta.url), "utf8");
const boundary = source.indexOf("await page.goto(new URL");
if (boundary < 0) throw new Error("Shared harness boundary changed");
const probe = String.raw`
const base = structuredClone(workspace.fundGoals[0]);
workspace.fundGoals = [
  { ...base, id: uuid("701"), name: "Building Fund", currentBalance: null, balanceDate: null },
  { ...base, id: uuid("702"), name: "Emergency Reserve", currentBalance: 0, balanceDate: "2026-10-01" },
  { ...base, id: uuid("703"), name: "Growth Fund", currentBalance: 125, balanceDate: null },
];
const before = structuredClone({ workspace, context, snapshots }), writes = [];
page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/") && !["GET", "HEAD"].includes(request.method())) writes.push(request.method()); });
try {
  await page.goto(new URL("/workspace", process.env.PRACTICE_PREVIEW_URL ?? "http://127.0.0.1:4318").href);
  await clickSection("Money");
  const rows = page.locator(".pw-fund-chart-row");
  const row = name => rows.filter({ has: page.getByText(name, { exact: true }) });
  console.log(JSON.stringify({ phase: "money", captions: await rows.locator(":scope > div:first-child").allInnerTexts(), writes }));
  if (process.env.FUND_PROVENANCE_PROBE_ONLY === "1") {
    await clickSection("Goals");
    console.log(JSON.stringify({ phase: "goals", labels: await page.locator(".pw-goal-fund").allInnerTexts(), writes }));
    return;
  }
  assert.match(await row("Building Fund").innerText(), /Assumed \$0.*no balance entered/);
  assert.doesNotMatch(await row("Building Fund").locator(":scope > div:first-child").innerText(), /recorded/i);
  assert.match(await row("Emergency Reserve").innerText(), /\$0 recorded balance.*2026-10-01/);
  assert.match(await row("Growth Fund").innerText(), /\$125 entered balance.*date not recorded/);
  assert.equal(await row("Building Fund").locator('.recharts-line-dot[name="Recorded balance"]').count(), 0);
  assert.equal(await row("Emergency Reserve").locator('.recharts-line-dot[name="Recorded balance"]').count(), 1);
  assert.equal(await row("Growth Fund").locator('.recharts-line-dot[name="Recorded balance"]').count(), 0);
  await capture("fund-provenance-money-desktop", 1280, 900); await capture("fund-provenance-money-mobile", 390, 900);
  await row("Building Fund").screenshot({ path: path.join(outDir, "fund-provenance-assumed-money-mobile.png") });
  await clickSection("Goals");
  const funds = page.locator(".pw-goal-fund");
  const fund = name => funds.filter({ has: page.getByText(name, { exact: true }) });
  assert.match(await fund("Building Fund").innerText(), /Assumed current balance: \$0.*no balance entered/);
  assert.match(await fund("Emergency Reserve").innerText(), /Current recorded balance: \$0 as of 2026-10-01/);
  assert.match(await fund("Growth Fund").innerText(), /Entered current balance: \$125.*date not recorded/);
  assert.equal(await fund("Building Fund").getByLabel("Assumed, goal, benchmark, and capacity comparison", { exact: true }).count(), 1);
  assert.equal(await fund("Emergency Reserve").getByLabel("Recorded, goal, benchmark, and capacity comparison", { exact: true }).count(), 1);
  assert.equal(await fund("Growth Fund").getByLabel("Entered (undated), goal, benchmark, and capacity comparison", { exact: true }).count(), 1);
  assert.equal(await fund("Building Fund").getByLabel("Current balance", { exact: true }).inputValue(), "");
  assert.equal(await fund("Emergency Reserve").getByLabel("Current balance", { exact: true }).inputValue(), "0");
  assert.equal(await fund("Growth Fund").getByLabel("Current balance", { exact: true }).inputValue(), "125");
  await capture("fund-provenance-goals-desktop", 1280, 900); await capture("fund-provenance-goals-mobile", 390, 900);
  await fund("Building Fund").screenshot({ path: path.join(outDir, "fund-provenance-assumed-goal-mobile.png") });
  await fund("Growth Fund").screenshot({ path: path.join(outDir, "fund-provenance-undated-goal-mobile.png") });
  await clickSection("Money");
  await page.getByLabel("Shared reporting period", { exact: true }).first().selectOption("custom");
  await page.getByLabel("From", { exact: true }).first().fill("2026-01-01");
  await page.getByLabel("Through", { exact: true }).first().fill("2026-01-31");
  assert.match(await row("Emergency Reserve").innerText(), /Historical balance unavailable.*2026-10-01/);
  assert.doesNotMatch(await row("Emergency Reserve").locator(":scope > div:first-child").innerText(), /\$0/);
  assert.equal(await row("Emergency Reserve").locator('.recharts-line-dot[name="Recorded balance"]').count(), 0);
  await capture("fund-provenance-historical-desktop", 1280, 900); await capture("fund-provenance-historical-mobile", 390, 900);
  await page.reload();
  await clickSection("Money");
  assert.match(await row("Building Fund").innerText(), /Assumed \$0.*no balance entered/);
  assert.deepEqual(writes, []); assert.deepEqual({ workspace, context, snapshots }, before);
  assert.deepEqual(browserErrors, []); assert.ok(checks.every(item => item.scrollWidth <= item.clientWidth + 1 && item.topNavigation));
  await fs.writeFile(path.join(outDir, "fund-balance-provenance-results.json"), JSON.stringify({ syntheticOnly: true, productionAccess: false, captures: checks.length, automaticWrites: 0, factsUnchanged: true, checks }, null, 2));
  console.log(JSON.stringify({ captures: checks.length, automaticWrites: 0, factsUnchanged: true, outDir }));
} catch (error) {
  console.log(JSON.stringify({ browserErrors, body: (await page.locator("body").innerText()).slice(0, 5000) }));
  throw error;
} finally { await browser.close(); }
`;
await import("data:text/javascript;base64," + Buffer.from(source.slice(0, boundary) + "async function runProbe() {\n" + probe + "\n}\nawait runProbe();").toString("base64"));
