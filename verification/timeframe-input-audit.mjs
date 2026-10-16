import fs from "node:fs/promises";
const source = await fs.readFile(new URL("./render-practice-workspace.mjs", import.meta.url), "utf8");
const boundary = source.indexOf("await page.goto(new URL");
if (boundary < 0) throw new Error("Shared harness boundary changed");
const probe = String.raw`
context.sessions.splice(0, context.sessions.length);
const names = context.clinicians.filter(person => person.goalId === workspace.settings.teamId).map(person => person.label);
const rows = names.flatMap((clinician, i) => [1, 2, 9, 13].map(day => ({ clientId: "synthetic-client-" + i, clinician, serviceDate: "2026-01-" + String(day).padStart(2, "0"), billingCode: day === 1 ? "PHONE" : "90837", status: "show", location: null, sourceRowHash: "synthetic-" + i + "-" + day })));
const proof = { start: "2026-01-01", end: "2026-01-28", complete: true };
snapshots.splice(0, snapshots.length, ...["attendance", "billing"].map((kind, i) => ({ id: kind + "-" + String(i + 1).repeat(16), kind, sourceHash: String(i + 1).repeat(16), importedAt: today + "T00:00:00Z", coverageStart: "2026-01-01", coverageEnd: "2026-01-13", reportCoverage: proof, rows: rows.map(row => kind === "attendance" ? row : { ...row, totalFeeCharged: row.billingCode === "PHONE" ? 0 : 100, sourceRowHash: "billing-" + row.sourceRowHash }) })));
const original = structuredClone({ workspace, context, snapshots });
const writes = [], tested = [];
page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/") && !["GET", "HEAD"].includes(request.method())) writes.push({ method: request.method(), path: new URL(request.url()).pathname }); });
const warning = "Custom dates are incomplete or reversed. Showing 2026-01-01 to 2026-01-14.";
const text = async () => (await page.locator(".pw-main").innerText()).replace(warning, "").replace(/\s+/g, " ").trim();
try {
  await page.goto(new URL("/workspace", process.env.PRACTICE_PREVIEW_URL ?? "http://127.0.0.1:4318").href);
  for (const tab of ["Overview", "Sessions", "Team", "Money", "Growth", "Goals", "Rooms"]) {
    if (tab === "Rooms") await page.getByRole("button", { name: "Growth", exact: true }).click();
    await page.getByRole(tab === "Rooms" ? "tab" : "button", { name: tab, exact: true }).click();
    const period = page.getByLabel("Shared reporting period", { exact: true }).first();
    await period.selectOption("custom");
    const from = page.getByLabel("From", { exact: true }).first();
    const through = page.getByLabel("Through", { exact: true }).first();
    await from.fill("2026-01-01"); await through.fill("2026-01-14");
    await page.waitForLoadState("networkidle");
    const before = await text();
    if (tab === "Sessions") {
      assert.match(await page.getByLabel("Sessions clinical card", { exact: true }).innerText(), /6 eligible sessions/);
      await capture("custom-date-valid-desktop", 1280, 900); await capture("custom-date-valid-mobile", 390, 900);
    }
    for (const [key, value, action] of [["from", "", "blank-start"], ["through", "", "blank-end"], ["from", "2026-01-15", "reversed-start"], ["through", "2025-12-31", "reversed-end"]]) {
      await (key === "from" ? from : through).fill(value);
      await page.getByText(warning, { exact: true }).waitFor();
      assert.equal(await from.getAttribute("aria-invalid"), "true");
      assert.equal(await through.getAttribute("aria-invalid"), "true");
      assert.ok(await from.getAttribute("aria-describedby"));
      assert.equal(await text(), before, tab + ": " + action + " must not change applied calculations");
      assert.deepEqual(browserErrors, []);
      tested.push({ tab, action, unchanged: true });
      if (tab === "Sessions" && action === "blank-start") { await capture("custom-date-blank-desktop", 1280, 900); await capture("custom-date-blank-mobile", 390, 900); }
      if (tab === "Money" && action === "reversed-start") { await capture("custom-date-reversed-money-desktop", 1280, 900); await capture("custom-date-reversed-money-mobile", 390, 900); }
      await from.fill("2026-01-01"); await through.fill("2026-01-14");
      assert.equal(await page.getByText(warning, { exact: true }).count(), 0);
      assert.equal(await from.getAttribute("aria-invalid"), "false");
    }
  }
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  const from = page.getByLabel("From", { exact: true }).first(), through = page.getByLabel("Through", { exact: true }).first();
  await from.fill("2026-01-15"); await page.getByText(warning, { exact: true }).waitFor();
  await through.fill("2026-01-28");
  await page.getByText(warning, { exact: true }).waitFor({ state: "detached" });
  assert.match(await page.getByLabel("Sessions clinical card", { exact: true }).innerText(), /0 eligible sessions/);
  await capture("custom-date-recovered-desktop", 1280, 900); await capture("custom-date-recovered-mobile", 390, 900);
  await page.getByRole("group", { name: "Sessions contributor", exact: true }).getByRole("button", { name: names[0], exact: true }).click();
  assert.equal(await from.inputValue(), "2026-01-15"); assert.equal(await through.inputValue(), "2026-01-28");
  await page.getByRole("button", { name: "Growth", exact: true }).click();
  assert.equal(await page.getByLabel("Shared reporting period", { exact: true }).first().inputValue(), "custom");
  assert.equal(await page.getByLabel("From", { exact: true }).first().inputValue(), "2026-01-15");
  const contributors = page.getByRole("group", { name: "Consult contributor", exact: true });
  assert.equal(await contributors.getByRole("button", { name: "Whole Practice", exact: true }).getAttribute("aria-pressed"), "true");
  assert.deepEqual(writes, []); assert.deepEqual({ workspace, context, snapshots }, original);
  assert.deepEqual(browserErrors, []); assert.ok(checks.every(row => row.scrollWidth <= row.clientWidth + 1 && row.topNavigation));
  await fs.writeFile(path.join(outDir, "timeframe-input-results.json"), JSON.stringify({ syntheticOnly: true, productionAccess: false, appliedRangePreserved: true, inputCases: tested, captures: checks.length, automaticWrites: 0, factsUnchanged: true, checks }, null, 2));
  console.log(JSON.stringify({ inputCases: tested.length, captures: checks.length, automaticWrites: 0, factsUnchanged: true, outDir }));
} finally { await browser.close(); }
`;
await import("data:text/javascript;base64," + Buffer.from(source.slice(0, boundary) + probe).toString("base64"));
