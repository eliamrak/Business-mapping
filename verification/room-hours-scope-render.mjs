import fs from "node:fs/promises";
const source = await fs.readFile(new URL("./render-practice-workspace.mjs", import.meta.url), "utf8");
const boundary = source.indexOf("await page.goto(new URL");
if (boundary < 0) throw new Error("Shared harness boundary changed");
const probe = String.raw`
const base = structuredClone(workspace.rooms[0]);
workspace.rooms = [
  { ...base, id: uuid("301"), name: "Current shared room", weeklyHours: 10, usablePct: 100, assignments: [{ clinicianId: 1, day: 1, startHour: 9, endHour: 11 }] },
  { ...base, id: uuid("302"), name: "Future dedicated room", weeklyHours: 40, usablePct: 100, usage: "dedicated", dedicatedClinicianId: 1, start: "2026-11-01" },
  { ...base, id: uuid("303"), name: "Expired dedicated room", weeklyHours: 20, usablePct: 100, usage: "dedicated", dedicatedClinicianId: 1, end: "2026-09-30" },
  { ...base, id: uuid("304"), name: "Review-only room", weeklyHours: 100, usablePct: 100, usage: "dedicated", dedicatedClinicianId: 1, planningOnly: true },
  { ...base, id: uuid("305"), name: "Archived room", weeklyHours: 30, usablePct: 100, usage: "dedicated", dedicatedClinicianId: 1, archived: true },
];
const original = structuredClone({ workspace, context, snapshots }), writes = [];
page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/") && !["GET", "HEAD"].includes(request.method())) writes.push(request.method()); });
try {
  await page.goto(new URL("/workspace", process.env.PRACTICE_PREVIEW_URL ?? "http://127.0.0.1:4318").href);
  await clickSection("Growth"); await page.getByRole("tab", { name: "Rooms", exact: true }).click();
  const panel = page.getByRole("heading", { name: "Room capacity vs demand", exact: true }).locator("../..").locator("..");
  const headline = panel.locator(".pw-consult-audit > div").first();
  const before = await headline.innerText();
  console.log(JSON.stringify({ phase: "initial", before, writes, browserErrors }));
  if (process.env.ROOM_SCOPE_PROBE_ONLY === "1") return;
  assert.match(before, /10\s+2 assigned\/open hours/);
  await capture("room-hours-current-desktop", 1280, 900); await capture("room-hours-current-mobile", 390, 900);
  const period = page.getByLabel("Shared reporting period", { exact: true }).first();
  await period.selectOption("custom");
  const from = page.getByLabel("From", { exact: true }).first(), through = page.getByLabel("Through", { exact: true }).first();
  for (const [start, end, slots, hours, name] of [
    ["2026-09-01", "2026-09-30", 30, 22, "inclusive-expiry"],
    ["2026-10-01", "2026-10-01", 10, 2, "after-expiry"],
    ["2026-11-01", "2026-11-30", 10, 2, "future-selection-clamped-to-today"],
    ["2025-12-01", "2025-12-31", 0, 0, "before-any-start"],
  ]) {
    await from.fill(start); await through.fill(end);
    assert.equal(await headline.locator("strong").innerText(), String(slots));
    assert.equal(await headline.locator("small").innerText(), hours + " assigned/open hours");
    await capture("room-hours-" + name + "-desktop", 1280, 900); await capture("room-hours-" + name + "-mobile", 390, 900);
  }
  assert.deepEqual(writes, []); assert.deepEqual({ workspace, context, snapshots }, original);
  assert.deepEqual(browserErrors, []); assert.ok(checks.every(row => row.scrollWidth <= row.clientWidth + 1 && row.topNavigation));
  await fs.writeFile(path.join(outDir, "room-hours-scope-results.json"), JSON.stringify({ syntheticOnly: true, productionAccess: false, captures: checks.length, automaticWrites: 0, factsUnchanged: true, checks }, null, 2));
  console.log(JSON.stringify({ captures: checks.length, automaticWrites: 0, factsUnchanged: true, outDir }));
} catch (error) {
  console.log(JSON.stringify({ browserErrors, body: (await page.locator("body").innerText()).slice(0, 5000) }));
  throw error;
} finally { await browser.close(); }
`;
await import("data:text/javascript;base64," + Buffer.from(source.slice(0, boundary) + "async function runProbe() {\n" + probe + "\n}\nawait runProbe();").toString("base64"));
