import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { syntheticClerkFixture } from "../artifacts/api-server/test/synthetic-clerk.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const runtime = process.env.PRACTICE_ACCEPTANCE_RUNTIME;
if (!runtime || !runtime.startsWith("/tmp/")) throw new Error("Set PRACTICE_ACCEPTANCE_RUNTIME to a temporary test-only dependency directory.");
const require = createRequire(path.join(repo, "artifacts/api-server/package.json"));
const dbRequire = createRequire(path.join(repo, "lib/db/package.json"));
const temporaryRequire = createRequire(path.join(runtime, "package.json"));
const { PGlite } = temporaryRequire("@electric-sql/pglite");
const { PGLiteSocketServer } = temporaryRequire("@electric-sql/pglite-socket");
const { build } = require("esbuild");
const { generateDrizzleJson, generateMigration } = dbRequire("drizzle-kit/api");
const out = process.env.PRACTICE_ACCEPTANCE_OUTPUT ?? await fs.mkdtemp("/tmp/practice-auth-saves-");
if (!path.resolve(out).startsWith("/tmp/")) throw new Error("Acceptance output/database must stay in /tmp.");
await fs.mkdir(out, { recursive: true });
const dataDir = path.join(out, "synthetic-database");
const clerk = syntheticClerkFixture();
const token = clerk.token("owner@example.test");
const checks = [];
let database, socket, child, base, uiBase, browser, page, appLog = "", ui;
const requests = [], browserErrors = [], screenshots = [];
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const buildProvenance = { commit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}") };
const runtimeChanges = git("diff", "HEAD", "--name-only", "--", "lib", "artifacts/api-server/src", "artifacts/comp-dashboard/src");
assert.equal(runtimeChanges, "", "Commit runtime changes before acceptance so source provenance is exact.");
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function moduleFrom(contents) {
  const result = await build({ stdin: { contents, resolveDir: repo, loader: "ts" }, bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent" });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}
async function startDatabase(initialize = false) {
  database = await PGlite.create({ dataDir });
  if (initialize) {
    const schema = await moduleFrom('export * from "./lib/db/src/schema/index.ts";');
    const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
    for (const statement of statements) await database.exec(statement);
  }
  socket = new PGLiteSocketServer({ db: database, host: "127.0.0.1", port: await freePort(), maxConnections: 20 });
  await socket.start();
}
async function call(endpoint, body, method = body ? "POST" : "GET", bearer = token, origin = uiBase ?? base) {
  const response = await fetch(base + "/api" + endpoint, {
    method, headers: { ...(bearer ? { authorization: "Bearer " + bearer } : {}), ...(body ? { "content-type": "application/json" } : {}), ...(origin ? { origin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
async function startApi(origin) {
  const port = await freePort();
  base = "http://127.0.0.1:" + port;
  const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, clerk.env, { DATABASE_URL: "postgresql://postgres:postgres@" + socket.getServerConn() + "/postgres", NODE_ENV: "development", HOST: "127.0.0.1", PORT: String(port), LOCAL_PREVIEW: "false", SEED_DEMO_DATA: "false", EMC_OWNER_EMAIL: "owner@example.test", EMC_PRACTICE_ID: "synthetic-goal-staff", APP_ORIGIN: origin ?? base });
  child = spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", data => { appLog += data; });
  child.stderr.on("data", data => { appLog += data; });
  for (let i = 0; i < 100; i++) {
    try { if ((await call("/healthz")).status === 200) return; } catch {}
    if (child.exitCode !== null) throw new Error("Isolated API exited: " + appLog.slice(-1600));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Isolated API startup timed out: " + appLog.slice(-1600));
}
async function stopApi() {
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
  child = null;
}
async function stopDatabase() {
  if (socket) await socket.stop();
  socket = null;
  // The socket adapter schedules detach callbacks after its server closes.
  await new Promise(resolve => setTimeout(resolve, 100));
  if (database) await database.close();
  database = null;
}
async function startUi() {
  const bundled = await build({
    stdin: { contents: "import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {TooltipProvider} from '@/components/ui/tooltip';import Access from '@/components/hub/access';import PracticeWorkspace from '@/pages/practice-workspace';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><TooltipProvider><Access><PracticeWorkspace/></Access></TooltipProvider></QueryClientProvider>);", loader: "tsx", resolveDir: path.join(repo, "artifacts/comp-dashboard") },
    bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic", alias: { "@": path.join(repo, "artifacts/comp-dashboard/src") },
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": '{"BASE_URL":"/"}' }, outdir: "/tmp/authenticated-acceptance-build",
    plugins: [{ name: "synthetic-identity-presentation", setup(builder) {
      builder.onResolve({ filter: /^@clerk\/react$/ }, () => ({ path: "clerk", namespace: "identity-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "identity-fixture" }, () => ({ contents: "export const useAuth=()=>({isLoaded:true,isSignedIn:true});export const useUser=()=>({user:{primaryEmailAddress:{emailAddress:'owner@example.test'}}});export const useClerk=()=>({signOut:async()=>{}});", loader: "js" }));
    } }, { name: "built-css", setup(builder) { builder.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "css" })); } }],
  });
  const assets = path.join(repo, "artifacts/comp-dashboard/dist/public/assets");
  const css = await fs.readFile(path.join(assets, (await fs.readdir(assets)).find(file => /^index-.*\.css$/.test(file))));
  ui = http.createServer(async (request, response) => {
    try {
      if (request.url.startsWith("/api/")) {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const upstream = await fetch(base + request.url, { method: request.method, headers: { ...request.headers, host: new URL(base).host }, body: ["GET", "HEAD"].includes(request.method) ? undefined : Buffer.concat(chunks) });
        requests.push({ method: request.method, path: request.url, status: upstream.status });
        response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/octet-stream" });
        response.end(Buffer.from(await upstream.arrayBuffer())); return;
      }
      if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundled.outputFiles.find(file => file.path.endsWith(".js")).contents); return; }
      if (request.url === "/styles.css") { response.setHeader("content-type", "text/css"); response.end(css); return; }
      response.setHeader("content-type", "text/html"); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
    } catch (error) { response.writeHead(502); response.end(error.message); }
  });
  await new Promise(resolve => ui.listen(0, "127.0.0.1", resolve));
  uiBase = "http://127.0.0.1:" + ui.address().port;
}
async function section(name) {
  await page.locator('nav[aria-label="Practice sections"] button', { hasText: name }).first().click();
  await page.waitForLoadState("networkidle");
}
const owner = () => page.locator(".pw-edit-item", { has: page.getByRole("heading", { name: "Owner pay", exact: true }) });
async function staffEditor() {
  await section("Money");
  await page.getByText("Edit dated money sources", { exact: true }).click();
  await page.getByText("Support staff pay", { exact: true }).click();
  await page.getByLabel("Synthetic Coordinator hourly rate", { exact: true }).waitFor();
}
async function inlineSave(label, value) {
  const response = page.waitForResponse(reply => new URL(reply.url()).pathname === "/api/hub" && reply.request().method() === "POST");
  await page.getByLabel(label, { exact: true }).fill(String(value));
  await page.getByLabel(label, { exact: true }).press("Enter");
  assert.equal((await response).status(), 200);
  await page.waitForLoadState("networkidle");
}
async function capture(name, locator) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const file = name + "-" + width + ".png";
    await locator.screenshot({ path: path.join(out, file) });
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(size.scroll <= size.client + 1, name + ": no document overflow");
    screenshots.push({ name, width, file, ...size });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
try {
  execFileSync(process.execPath, ["artifacts/api-server/build.mjs"], { cwd: repo, stdio: "pipe" });
  execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], { cwd: path.join(repo, "artifacts/comp-dashboard"), env: { ...process.env, PORT: "4318", BASE_PATH: "/" }, stdio: "pipe" });
  buildProvenance.apiBundleSha256 = createHash("sha256").update(await fs.readFile(path.join(repo, "artifacts/api-server/dist/index.mjs"))).digest("hex");
  await startDatabase(true);
  const wire = new (dbRequire("pg").Client)({ connectionString: "postgresql://postgres:postgres@" + socket.getServerConn() + "/postgres" });
  await wire.connect();
  try {
    assert.equal((await wire.query("select $1::text as value", ["synthetic"])).rows[0].value, "synthetic");
    assert.equal((await wire.query("select count(*)::integer as count from business_goals")).rows[0].count, 0);
  } finally { await wire.end(); }
  await startUi();
  await startApi(uiBase);
  assert.equal((await call("/hub", undefined, "GET", null)).status, 401);
  assert.equal((await call("/auth/me", undefined, "GET", token.slice(0, -5) + "xxxxx")).status, 401);
  assert.equal((await call("/auth/me", undefined, "GET", clerk.token("uninvited@example.test"))).status, 403);
  assert.deepEqual(await call("/auth/me"), { status: 200, data: { actor: "owner@example.test", role: "owner" } });
  checks.push("Actual Clerk middleware: missing/invalid JWT 401, uninvited identity 403, isolated configured owner 200");
  const version = (await database.query("select version() as version")).rows[0].version;
  const team = await call("/business-goals", { name: "Synthetic acceptance practice", ownerPayGoal: 0, secondOwnerPayGoal: 0, desiredCliniciansCount: 1 });
  assert.equal(team.status, 201, JSON.stringify(team.data));
  const staff = await call("/staff", { goalId: team.data.id, label: "Synthetic Coordinator", hourlyRate: 18, hoursPerWeek: 10, weeksPerYear: 48, w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 });
  assert.equal(staff.status, 201, JSON.stringify(staff.data));
  const model = await moduleFrom('export * from "./lib/practice/src/hub/index.ts";');
  let state = (await call("/hub")).data;
  const workspace = model.emptyWorkspace("2026-10-01");
  Object.assign(workspace.settings, { practiceName: "Synthetic acceptance practice", teamId: team.data.id, baselineMode: "manual", baselineWeeklySessions: 10, defaultInPersonPct: 0, ownerPayrollMonthly: 0, ownerPayrollOverride: true, overheadFloorMonthly: 0, overheadFloorOverride: true, horizonMonths: 12 });
  workspace.goals.push(model.goalSchema.parse({ id: randomUUID(), name: "Owner pay", metric: "ownerDistributionsPretax", amount: 120000, basis: "annual" }));
  const saved = await call("/hub", { requestId: randomUUID(), expectedRevision: state.revision, action: "Synthetic acceptance setup", data: workspace });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  state = saved.data;
  assert.equal((await call("/hub", { requestId: randomUUID(), expectedRevision: state.revision, action: "Wrong-origin rejection", data: state.data }, "POST", token, "http://invalid.example.test")).status, 403);
  for (const [bearer, status] of [[null, 401], [token.slice(0, -5) + "xxxxx", 401], [clerk.token("uninvited@example.test"), 403]]) {
    assert.equal((await call("/hub", { requestId: randomUUID(), expectedRevision: state.revision, action: "Synthetic unauthorized refusal", data: state.data }, "POST", bearer)).status, status);
  }
  assert.equal((await call("/hub")).data.revision, 1);
  assert.equal((await call("/hub/history")).data.length, 1);
  checks.push("Unchanged pg/Drizzle API inserts synthetic team/staff/workspace; wrong-origin write refused");
  checks.push("Missing/invalid JWT and uninvited identity cannot save; no revision or audit change");
  const sourceStaff = structuredClone(staff.data);
  const playwright = createRequire(process.env.PRACTICE_PLAYWRIGHT_PACKAGE ?? "/tmp/forge-reviewed-da6f1d2c-stage/package.json")("playwright");
  browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.PRACTICE_BROWSER_PATH ?? "/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { authorization: "Bearer " + token } });
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === uiBase ? route.continue() : route.abort());
  await page.clock.install({ time: new Date("2026-10-18T16:00:00Z") });
  await page.goto(uiBase + "/workspace");
  await section("Goals");
  assert.equal(await owner().getByLabel("Goal amount", { exact: true }).inputValue(), "120000");
  await owner().getByLabel("Goal amount", { exact: true }).fill("144000");
  await owner().getByLabel("Goal amount", { exact: true }).blur();
  await owner().getByLabel("Owner pay basis", { exact: true }).selectOption("annual");
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  const annualResponse = page.waitForResponse(reply => new URL(reply.url()).pathname === "/api/hub" && reply.request().method() === "POST");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  assert.equal((await annualResponse).status(), 200);
  await page.reload(); await section("Goals");
  assert.equal(await owner().getByLabel("Goal amount", { exact: true }).inputValue(), "144000");
  assert.equal(await owner().getByLabel("Owner pay basis", { exact: true }).inputValue(), "annual");
  assert.match(await owner().innerText(), /Goal line\s+\$12,000/);
  state = (await call("/hub")).data;
  assert.equal(state.data.goals.find(goal => goal.name === "Owner pay").amount, 144000);
  assert.equal(state.data.goals.find(goal => goal.name === "Owner pay").basis, "annual");
  assert.equal((await call("/business-goals/" + team.data.id)).data.ownerPayGoal, 0, "Today goal must not rewrite legacy target");
  checks.push("Real annual Goal UI review/save and reload: 144000 annual persisted; monthly goal line12000; legacy target unchanged");
  await capture("annual-goal-reloaded", owner());
  await staffEditor();
  assert.equal(await page.getByLabel("Synthetic Coordinator hourly rate", { exact: true }).inputValue(), "18");
  assert.equal(await page.getByLabel("Synthetic Coordinator rate timing", { exact: true }).inputValue(), "year");
  await inlineSave("Synthetic Coordinator hourly rate", 22);
  await inlineSave("Synthetic Coordinator hours per week", 12);
  await page.reload(); await staffEditor();
  assert.equal(await page.getByLabel("Synthetic Coordinator hourly rate", { exact: true }).inputValue(), "22");
  assert.equal(await page.getByLabel("Synthetic Coordinator hours per week", { exact: true }).inputValue(), "12");
  state = (await call("/hub")).data;
  const yearly = state.data.staffTerms.find(term => term.staffMemberId === sourceStaff.id && term.effectiveDate === "2026-01-01");
  assert.equal(yearly.end, "2026-12-31"); assert.equal(yearly.hourlyRate, 22); assert.equal(yearly.hoursPerWeek, 12);
  checks.push("Real staff year-default inline commits and reload:22/hour,12hours/week,one2026 term; source staff row unchanged");
  await capture("staff-year-rate-reloaded", page.locator(".pw-flow-source-row").filter({ has: page.getByText("Synthetic Coordinator", { exact: true }) }));
  await page.getByLabel("Synthetic Coordinator rate timing", { exact: true }).selectOption("date");
  await page.getByLabel("Synthetic Coordinator rate start date", { exact: true }).fill("2026-10-16");
  await inlineSave("Synthetic Coordinator hourly rate", 24);
  await page.reload(); await staffEditor();
  await page.getByLabel("Synthetic Coordinator rate timing", { exact: true }).selectOption("date");
  await page.getByLabel("Synthetic Coordinator rate start date", { exact: true }).fill("2026-10-16");
  assert.equal(await page.getByLabel("Synthetic Coordinator hourly rate", { exact: true }).inputValue(), "24");
  assert.equal(await page.getByLabel("Synthetic Coordinator hours per week", { exact: true }).inputValue(), "12");
  state = (await call("/hub")).data;
  const terms = state.data.staffTerms.filter(term => term.staffMemberId === sourceStaff.id);
  assert.equal(terms.length, 2);
  assert.equal(terms.find(term => term.effectiveDate === "2026-10-16").hourlyRate, 24);
  assert.equal(terms.find(term => term.effectiveDate === "2026-10-16").end, null);
  assert.equal(model.staffMemberAt(state.data, sourceStaff, "2026-10-15").hourlyRate, 22);
  assert.equal(model.staffMemberAt(state.data, sourceStaff, "2026-10-16").hourlyRate, 24);
  assert.equal(model.staffMemberAt(state.data, sourceStaff, "2026-10-16").hoursPerWeek, 12);
  assert.deepEqual((await call("/staff")).data.find(member => member.id === sourceStaff.id), sourceStaff);
  checks.push("Real dated-rate inline commit and reload:24/hour fromOct16;Oct15 stays22;12hours inherited; exactlytwo terms,originalstaff unchanged");
  await capture("staff-dated-rate-reloaded", page.locator(".pw-flow-source-row").filter({ has: page.getByText("Synthetic Coordinator", { exact: true }) }));
  await page.getByLabel("Synthetic Coordinator rate timing", { exact: true }).selectOption("year");
  assert.equal(await page.getByLabel("Synthetic Coordinator hourly rate", { exact: true }).inputValue(), "22", "Annual scope must display its own22 default,not the later24 override.");
  // This equals the dated override, but differs from the annual default and must save.
  await inlineSave("Synthetic Coordinator hourly rate", 24);
  assert.equal((await call("/hub")).data.data.staffTerms.find(term => term.end === "2026-12-31").hourlyRate, 24);
  await inlineSave("Synthetic Coordinator hourly rate", 26);
  await page.reload(); await staffEditor();
  assert.equal(await page.getByLabel("Synthetic Coordinator hourly rate", { exact: true }).inputValue(), "26");
  await page.getByLabel("Synthetic Coordinator rate timing", { exact: true }).selectOption("date");
  await page.getByLabel("Synthetic Coordinator rate start date", { exact: true }).fill("2026-10-16");
  assert.equal(await page.getByLabel("Synthetic Coordinator hourly rate", { exact: true }).inputValue(), "24");
  state = (await call("/hub")).data;
  assert.equal(state.data.staffTerms.filter(term => term.staffMemberId === sourceStaff.id).length, 2);
  assert.equal(model.staffMemberAt(state.data, sourceStaff, "2026-10-15").hourlyRate, 26);
  assert.equal(model.staffMemberAt(state.data, sourceStaff, "2026-10-16").hourlyRate, 24);
  checks.push("Scope regression:annual editor shows its own default;24 equal to dated override stillsaves annual;26 annual survives reload whiledated24 staysindependent");
  const sqlBeforeRestart = (await database.query("select revision,data from hub_workspaces where id=1")).rows[0];
  assert.deepEqual(sqlBeforeRestart.data, state.data);
  assert.equal((await call("/hub", { requestId: randomUUID(), expectedRevision: 1, action: "Synthetic stale refusal", data: workspace })).status, 409);
  assert.deepEqual((await call("/hub")).data.data, state.data);
  const historyBefore = (await call("/hub/history")).data;
  assert.equal(state.revision, 7, "Fixture plus six distinct UI saves advance exactly seven revisions.");
  assert.equal(historyBefore.length, 7, "Every successful save must have an audit row.");
  assert.deepEqual(historyBefore.map(row => row.revision).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(historyBefore.every(row => row.actor === "owner@example.test"));
  const sqlHistory = (await database.query("select revision,actor from hub_history order by revision")).rows;
  assert.deepEqual(sqlHistory, [1, 2, 3, 4, 5, 6, 7].map(revision => ({ revision, actor: "owner@example.test" })));
  checks.push("SQL read-back equals API snapshot; stale revision409 preserves all saved changes; audit actor is verified synthetic owner");
  await stopApi(); await stopDatabase(); await startDatabase(); await startApi(uiBase);
  const durable = (await call("/hub")).data;
  assert.deepEqual(durable.data, state.data); assert.equal(durable.revision, state.revision);
  assert.deepEqual((await call("/hub/history")).data, historyBefore);
  await page.reload(); await section("Goals");
  assert.equal(await owner().getByLabel("Goal amount", { exact: true }).inputValue(), "144000");
  assert.equal(await owner().getByLabel("Owner pay basis", { exact: true }).inputValue(), "annual");
  await staffEditor();
  assert.equal(await page.getByLabel("Synthetic Coordinator hourly rate", { exact: true }).inputValue(), "26");
  assert.equal(await page.getByLabel("Synthetic Coordinator hours per week", { exact: true }).inputValue(), "12");
  await capture("staff-year-scope-after-restart", page.locator(".pw-flow-source-row").filter({ has: page.getByText("Synthetic Coordinator", { exact: true }) }));
  await page.getByLabel("Synthetic Coordinator rate timing", { exact: true }).selectOption("date");
  await page.getByLabel("Synthetic Coordinator rate start date", { exact: true }).fill("2026-10-16");
  assert.equal(await page.getByLabel("Synthetic Coordinator hourly rate", { exact: true }).inputValue(), "24");
  assert.deepEqual((await call("/staff")).data.find(member => member.id === sourceStaff.id), sourceStaff);
  checks.push("API and embedded database fully stopped/reopened fromdisk; annualgoal,staffterms,source staff,audit and revision survive; UI reload confirms");
  assert.deepEqual(browserErrors, []);
  assert.equal(requests.filter(request => request.method === "POST").length, 6);
  assert.ok(requests.filter(request => request.method === "POST").every(request => request.path === "/api/hub" && request.status === 200));
  const result = { candidate: buildProvenance.commit, sourceTree: buildProvenance.tree, buildProvenance, environment: { engine: version, storage: "filesystem-backed embedded PostgreSQL over loopback wire protocol, unchangedpg/DrizzleAPI", authentication: "actual Clerk middleware and requireAccess; fresh local RS256 key; frontend identity hook fixture,notGoogleOAuth", nativePostgres: "unavailable:hostSysVshared-memoryexhausted", realBusinessData: false, productionAccess: false, externalRequestsAllowed: false }, checks, browserErrors, screenshots, requests, finalRevision: durable.revision, auditRows: historyBefore.length, staffTerms: durable.data.staffTerms, annualGoal: durable.data.goals.find(goal => goal.name === "Owner pay") };
  await fs.writeFile(path.join(out, "results.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ out, checks: checks.length, finalRevision: durable.revision, auditRows: historyBefore.length, browserErrors, screenshots: screenshots.length }));
} catch (error) {
  if (page) await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ out, message: error.message?.split("data:text/javascript")[0], browserErrors, body: page ? (await page.locator("body").innerText().catch(() => "")).slice(0, 2200) : null, appLog: appLog.slice(-2000) }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (ui) await new Promise(resolve => ui.close(resolve));
  await stopApi();
  await stopDatabase();
}
