import fs from "node:fs/promises";
const source = await fs.readFile(new URL("./render-practice-workspace.mjs", import.meta.url), "utf8");
const boundary = source.indexOf("await page.goto(new URL");
if (boundary < 0) throw new Error("Shared harness boundary changed");
const probe = String.raw`
const person = context.clinicians.find(row => row.goalId === workspace.settings.teamId);
context.sessions.splice(0, context.sessions.length);
snapshots.splice(0, snapshots.length, { id: "attendance-" + "1".repeat(16), kind: "attendance", sourceHash: "1".repeat(16), importedAt: today + "T00:00:00Z", coverageStart: "2025-12-02", coverageEnd: "2026-01-10", reportCoverage: { start: "2025-12-01", end: "2026-06-30", complete: true }, rows: [1, 2, 3].flatMap(client => ["2025-12-02", "2025-12-09", "2025-12-16", "2026-01-10"].map(serviceDate => ({ clientId: "synthetic-" + client, clinician: person.label, serviceDate, status: "show", location: null, sourceRowHash: "synthetic-" + client + serviceDate }))) });
const before = structuredClone({ workspace, context, snapshots }), writes = [];
page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/") && !["GET", "HEAD"].includes(request.method())) writes.push(request.method()); });
try {
  await page.goto(new URL("/workspace", process.env.PRACTICE_PREVIEW_URL ?? "http://127.0.0.1:4318").href);
  await clickSection("Team");
  await page.getByLabel("Shared reporting period", { exact: true }).selectOption("custom");
  const from = page.getByLabel("From", { exact: true }).first(), through = page.getByLabel("Through", { exact: true }).first();
  await from.fill("2026-01-01"); await through.fill("2026-01-31");
  const card = page.locator("article.pw-person").filter({ has: page.getByRole("heading", { name: person.label, exact: true }) });
  const attrition = card.getByText("Attrition", { exact: true }).locator("..");
  for (const [end, value, denominator, name] of [["2026-01-31", "3", "1 fully observed mature month", "one-month"], ["2026-02-28", "1.5", "2 fully observed mature months", "two-months"]]) {
    await through.fill(end);
    await attrition.getByText(denominator, { exact: true }).waitFor();
    assert.equal(await attrition.locator("strong").innerText(), value);
    assert.doesNotMatch(await attrition.innerText(), /client-months/);
    await capture("team-attrition-" + name + "-desktop", 1280, 900); await capture("team-attrition-" + name + "-mobile", 390, 900);
  }
  await through.fill("2026-01-31"); await from.fill("2026-01-15");
  await attrition.getByText("no mature observed months", { exact: true }).waitFor();
  assert.equal(await attrition.locator("strong").innerText(), "--");
  await capture("team-attrition-unavailable-desktop", 1280, 900); await capture("team-attrition-unavailable-mobile", 390, 900);
  assert.deepEqual(writes, []); assert.deepEqual({ workspace, context, snapshots }, before);
  assert.deepEqual(browserErrors, []); assert.ok(checks.every(row => row.scrollWidth <= row.clientWidth + 1 && row.topNavigation));
  await fs.writeFile(path.join(outDir, "team-attrition-units-results.json"), JSON.stringify({ syntheticOnly: true, productionAccess: false, captures: checks.length, automaticWrites: 0, factsUnchanged: true, checks }, null, 2));
  console.log(JSON.stringify({ captures: checks.length, automaticWrites: 0, factsUnchanged: true, outDir }));
} catch (error) {
  console.log(JSON.stringify({ browserErrors, body: (await page.locator("body").innerText()).slice(0, 5000) }));
  throw error;
} finally { await browser.close(); }
`;
await import("data:text/javascript;base64," + Buffer.from(source.slice(0, boundary) + probe).toString("base64"));
