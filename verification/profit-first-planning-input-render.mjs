import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Default/--build-only never binds a server or launches Chrome. --run is for
// the later serialized render gate after the publisher releases the resource.
const args = process.argv.slice(2);
assert.ok(args.every(arg => ["--build-only", "--run"].includes(arg)), "Use --build-only or --run");
assert.ok(!(args.includes("--run") && args.includes("--build-only")), "Choose one mode");
const run = args.includes("--run");
const repo = fileURLToPath(new URL("../", import.meta.url));
const git = (...params) => execFileSync("git", params, { cwd: repo, encoding: "utf8" }).trim();
assert.equal(git("diff", "HEAD", "--name-only", "--", "artifacts", "lib"), "", "Runtime must be frozen before rendering");
const provenance = { commit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}") };
const { build } = createRequire(path.join(repo, "artifacts/api-server/package.json"))("esbuild");
const playwrightRequire = createRequire(process.env.PRACTICE_PLAYWRIGHT_PACKAGE ?? "/tmp/forge-reviewed-da6f1d2c-stage/package.json");
const playwrightPath = playwrightRequire.resolve("playwright");
const executablePath = process.env.PRACTICE_FULL_CHROME
  ?? "/Users/eliam/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
await fs.access(executablePath);

const bundled = await build({
  stdin: { loader: "tsx", resolveDir: path.join(repo, "artifacts/comp-dashboard"), contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import ProfitFirstPlanning from '@/components/practice/profit-first-planning';
    import {emptyWorkspace, workspaceSchema} from '@workspace/practice/hub';
    const seed = emptyWorkspace('2026-01-01');
    seed.moneyPlanning = {
      estimatedMonthlyValues: {revenue: 10000, overhead: 1200, otherIncome: 0},
      scenarioPercents: {'business-profit': 150},
      goals: [
        {id: crypto.randomUUID(), name: 'Building fund monthly contribution', bucket: 'business-profit', mode: 'additional', monthlyAmount: 250},
        {id: crypto.randomUUID(), name: 'Synthetic custom contribution', bucket: 'business-profit', mode: 'additional', monthlyAmount: 75}
      ]
    };
    const original = structuredClone(seed);
    const fixture = window.fixture = {callbacks: [], events: [], current: structuredClone(seed), reset: null, sourceUnchanged: () => JSON.stringify(seed) === JSON.stringify(original)};
    for (const type of ['input', 'change', 'blur']) document.addEventListener(type, event => {
      const input = event.target;
      if (input instanceof HTMLInputElement) fixture.events.push({type, label: input.getAttribute('aria-label'), value: input.value, badInput: input.validity.badInput, rangeOverflow: input.validity.rangeOverflow});
    }, true);
    function App() {
      const [workspace, setWorkspace] = useState(() => structuredClone(seed));
      const [epoch, setEpoch] = useState(0);
      fixture.reset = () => {
        fixture.callbacks = []; fixture.events = []; fixture.current = structuredClone(seed);
        setWorkspace(structuredClone(seed)); setEpoch(current => current + 1);
      };
      return <main style={{padding: 16, maxWidth: 1280, margin: '0 auto'}}>
        <button id="fixture-blur" type="button">Fixture blur target</button>
        <ProfitFirstPlanning key={epoch} workspace={workspace} context={{clinicians: [], staff: [], sessions: []}}
          asOf="2026-01-15" estimateSourcePeriod="Synthetic January 2026 monthly planning fixture"
          estimatedMonthlyValues={{clinicianPay: 0, employerBurden: 0, staffCost: 0, fees: 0, marketing: 0}}
          onPlanningChange={moneyPlanning => {
            const next = workspaceSchema.parse(JSON.parse(JSON.stringify({...workspace, moneyPlanning})));
            fixture.callbacks.push(structuredClone(next.moneyPlanning));
            fixture.current = structuredClone(next); setWorkspace(next);
          }} />
      </main>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` },
  bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic",
  alias: { "@": path.join(repo, "artifacts/comp-dashboard/src") },
  define: { "process.env.NODE_ENV": '"test"' },
  plugins: [{ name: "existing-built-css", setup(builder) {
    builder.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "css" }));
  } }],
  outdir: "/tmp/profit-first-planning-input-build",
});
const js = bundled.outputFiles.find(file => file.path.endsWith(".js"));
assert.ok(js?.contents.length, "Actual TSX bundle must be nonempty");
const assets = path.join(repo, "artifacts/comp-dashboard/dist/public/assets");
const cssNames = (await fs.readdir(assets)).filter(name => /^index-.*\.css$/.test(name));
assert.equal(cssNames.length, 1, "Expected one current dashboard CSS entry");
const cssPath = path.join(assets, cssNames[0]);
const css = await fs.readFile(cssPath);
assert.ok(css.includes(Buffer.from(".pf-planning")), "Existing build must include the actual planner CSS");
const buildEvidence = {
  provenance, playwrightPath, executablePath, bundleBytes: js.contents.length,
  cssPath, cssSha256: createHash("sha256").update(css).digest("hex"),
};

if (!run) {
  console.log(JSON.stringify({ status: "prepared-not-run", ...buildEvidence, serverStarted: false, browserLaunched: false }));
} else {
  await runRender();
}

async function runRender() {
  const { chromium } = playwrightRequire("playwright");
  const out = await fs.mkdtemp(path.join(await fs.realpath("/tmp"), "profit-first-planning-input-render-"));
  const requests = [], browserErrors = [], cases = [], captures = [];
  let server, browser, page, ax, base, active;
  const labels = {
    revenue: "Monthly billed revenue estimate", floor: "Business profit scenario percentage floor",
    other: "Other monthly income estimate", goal: "Building fund monthly contribution", custom: "Synthetic custom contribution",
  };
  const allowedPaths = new Set(["/", "/bundle.js", "/styles.css", "/favicon.ico"]);
  const input = name => page.getByLabel(name, { exact: true });
  const count = () => page.evaluate(() => window.fixture.callbacks.length);
  const state = () => page.evaluate(() => ({ current: window.fixture.current, callbacks: window.fixture.callbacks, events: window.fixture.events }));
  const blur = () => page.locator("#fixture-blur").click();
  const assertCount = async expected => assert.equal(await count(), expected, "Unexpected parent staging callback");
  const last = async () => (await state()).callbacks.at(-1);
  const change = async (name, value) => { await input(name).fill(value); await blur(); };
  async function assertError(name) {
    // Both label lookup and the computed accessible name must remain exact.
    assert.equal(await page.getByRole("spinbutton", { name, exact: true }).count(), 1);
    const error = await input(name).evaluate(node => {
      const id = node.getAttribute("aria-describedby");
      const description = id && document.getElementById(id);
      return { invalid: node.getAttribute("aria-invalid"), id, role: description?.getAttribute("role"),
        text: description?.textContent, visible: !!description?.getClientRects().length };
    });
    assert.equal(error.invalid, "true");
    assert.ok(error.id);
    assert.equal(error.role, "alert");
    assert.equal(error.visible, true);
    assert.match(error.text, /finite, nonnegative/);
    const { nodes } = await ax.send("Accessibility.getFullAXTree");
    const control = nodes.find(node => !node.ignored && node.role?.value === "spinbutton" && node.name?.value === name);
    assert.ok(control, "Exact accessible name must survive inline validation");
    assert.match(control.description?.value ?? "", /finite, nonnegative/);
    return error;
  }
  async function assertClear(name) {
    assert.equal(await input(name).getAttribute("aria-invalid"), "false");
    assert.equal(await input(name).getAttribute("aria-describedby"), null);
  }
  async function reset() {
    await page.evaluate(() => window.fixture.reset());
    await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Monthly billed revenue estimate"]')?.value) === 10000
      && !document.querySelector('[aria-invalid="true"]'));
    const summary = page.getByText("Cost estimates and source periods", { exact: true });
    if (!await summary.evaluate(node => node.parentElement.open)) await summary.click();
    assert.equal(await input(labels.floor).inputValue(), "150");
    await assertCount(0);
  }
  async function capture(name, width, height) {
    const geometry = await page.evaluate(() => ({
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    }));
    assert.equal(geometry.width, width);
    assert.equal(geometry.height, height);
    assert.equal(geometry.dpr, 1, "Use native 100% viewport sizing, without CSS zoom emulation");
    assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, "Document overflow outside the bounded table");
    const screenshot = `${width}-${name}.png`;
    await page.screenshot({ path: path.join(out, screenshot), fullPage: true });
    captures.push({ name, screenshot, ...geometry });
  }
  async function check(name, width, height, body) {
    active = { name, width, height, status: "running" };
    cases.push(active);
    await reset();
    await body();
    assert.equal(await page.evaluate(() => window.fixture.sourceUnchanged()), true);
    active.evidence = await state();
    await capture(name, width, height);
    active.status = "pass";
  }
  try {
    server = http.createServer((request, response) => {
      if (request.method !== "GET" || !allowedPaths.has(request.url)) {
        response.writeHead(405); response.end(); return;
      }
      response.setHeader("Cache-Control", "no-store");
      if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); return; }
      response.setHeader("Content-Type", request.url === "/bundle.js" ? "text/javascript" : request.url === "/styles.css" ? "text/css" : "text/html");
      response.end(request.url === "/bundle.js" ? js.contents : request.url === "/styles.css" ? css
        : '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launchPersistentContext(path.join(out, "owned-chrome-profile"), {
      executablePath, headless: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, serviceWorkers: "block",
    });
    await browser.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      const allowed = request.method() === "GET" && url.origin === base && allowedPaths.has(url.pathname) && !url.search;
      requests.push({ method: request.method(), url: request.url(), allowed });
      return allowed ? route.continue() : route.abort();
    });
    page = browser.pages()[0] ?? await browser.newPage();
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(10000);
    page.on("pageerror", error => browserErrors.push(error.message));
    page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
    page.on("dialog", async dialog => { browserErrors.push(`Unexpected ${dialog.type()} dialog: ${dialog.message()}`); await dialog.dismiss(); });
    ax = await browser.newCDPSession(page);
    await page.goto(base);
    const estimates = page.getByText("Cost estimates and source periods", { exact: true });
    await estimates.waitFor();
    if (!await estimates.evaluate(node => node.parentElement.open)) await estimates.click();
    await input(labels.revenue).waitFor();

    for (const { width, height } of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize({ width, height });
      await check("initial-negative-estimate", width, height, async () => {
        await change(labels.revenue, "-1");
        await assertCount(0);
        assert.equal((await state()).current.moneyPlanning.estimatedMonthlyValues.revenue, 10000);
        assert.equal(await input(labels.revenue).inputValue(), "-1");
        active.error = await assertError(labels.revenue);
      });
      await check("initial-negative-floor", width, height, async () => {
        await change(labels.floor, "-1");
        await assertCount(0);
        assert.equal((await state()).current.moneyPlanning.scenarioPercents["business-profit"], 150);
        assert.equal(await input(labels.floor).inputValue(), "-1");
        active.error = await assertError(labels.floor);
      });
      for (const name of [labels.revenue, labels.floor, labels.goal]) for (const raw of ["-", "1e"]) {
        const slug = name === labels.revenue ? "estimate" : name === labels.floor ? "floor" : "goal";
        await check(`native-${slug}-${raw === "-" ? "minus" : "exponent"}`, width, height, async () => {
          const control = input(name);
          await control.focus();
          await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
          // Replace the selected value directly: no intervening intentional blank.
          await page.keyboard.type(raw, { delay: 80 });
          const native = await control.evaluate(node => ({ value: node.value, badInput: node.validity.badInput }));
          assert.equal(native.value, "", "Native incomplete numeric input must be sanitized to empty");
          // React can clear native badInput during its controlled rerender. The
          // capture listener records the real event before React handles it.
          const nativeEvents = (await state()).events.filter(event => event.type === "input" && event.label === name && event.badInput && event.value === "");
          assert.ok(nativeEvents.length, "Real keystrokes must produce native badInput; do not silently substitute synthetic events");
          await assertError(name);
          await blur();
          await assertCount(0);
          await assertError(name);
          const evidence = await state();
          assert.ok(evidence.events.some(event => event.type === "input" && event.label === name && event.badInput && event.value === ""));
          assert.equal(evidence.current.moneyPlanning.estimatedMonthlyValues.revenue, 10000);
          assert.equal(evidence.current.moneyPlanning.scenarioPercents["business-profit"], 150);
          assert.equal(evidence.current.moneyPlanning.goals.find(goal => goal.name === labels.goal).monthlyAmount, 250);
          active.native = native;
          active.nativeBadInputEvents = nativeEvents;
        });
      }
      await check("intermediate-preview-blocks-grouped-staging", width, height, async () => {
        await input(labels.revenue).fill("9");
        await assertCount(0);
        await input(labels.revenue).fill("-1");
        await change(labels.other, "12");
        await assertCount(0);
        assert.equal(await input(labels.revenue).inputValue(), "-1");
        assert.equal(await input(labels.other).inputValue(), "12");
        await assertError(labels.revenue);
        assert.equal((await state()).current.moneyPlanning.estimatedMonthlyValues.revenue, 10000);
        await change(labels.revenue, "11000");
        await assertCount(1);
        assert.equal((await last()).estimatedMonthlyValues.revenue, 11000);
        assert.equal((await last()).estimatedMonthlyValues.otherIncome, 12);
        await assertClear(labels.revenue);
      });
      await check("intentional-blank-zero-and-infeasible-floor", width, height, async () => {
        await change(labels.revenue, ""); await assertCount(1);
        assert.equal((await last()).estimatedMonthlyValues.revenue, null);
        await change(labels.revenue, "0"); await assertCount(2);
        assert.equal((await last()).estimatedMonthlyValues.revenue, 0);
        await change(labels.revenue, "10000"); await assertCount(3);
        await change(labels.floor, "175"); await assertCount(4);
        assert.equal((await last()).scenarioPercents["business-profit"], 175);
        assert.equal(await input(labels.floor).inputValue(), "175");
        await page.getByText("Planned costs and goals exceed estimated income", { exact: true }).waitFor();
        await change(labels.floor, ""); await assertCount(5);
        assert.equal((await last()).scenarioPercents["business-profit"], null);
        await change(labels.floor, "0"); await assertCount(6);
        assert.equal((await last()).scenarioPercents["business-profit"], 0);
        await assertClear(labels.floor);
      });
      await check("money-maximum-before-staging", width, height, async () => {
        await change(labels.revenue, "10000000001");
        await assertCount(0); await assertError(labels.revenue);
        await change(labels.revenue, "10000000000"); await assertCount(1);
        assert.equal((await last()).estimatedMonthlyValues.revenue, 1e10);
        await assertClear(labels.revenue);
      });
      for (const name of [labels.goal, labels.custom]) {
        await check(name === labels.goal ? "preset-goal-invalid-corrected" : "custom-goal-invalid-corrected", width, height, async () => {
          await change(name, "-1"); await assertCount(0); await assertError(name);
          await change(labels.other, "8"); await assertCount(0); await assertError(name);
          assert.equal(await input(name).inputValue(), "-1");
          await change(name, "500"); await assertCount(1);
          assert.equal((await last()).goals.find(goal => goal.name === name).monthlyAmount, 500);
          assert.equal((await last()).estimatedMonthlyValues.otherIncome, 8);
          await assertClear(name);
          await change(name, ""); await assertCount(2);
          assert.equal((await last()).goals.find(goal => goal.name === name).monthlyAmount, null);
          await change(name, "0"); await assertCount(3);
          assert.equal((await last()).goals.find(goal => goal.name === name).monthlyAmount, 0);
        });
      }
    }
    assert.equal(cases.length, 26, "Every desktop/mobile case must execute");
    assert.equal(captures.length, 26, "Every passing case must retain a capture");
    assert.deepEqual(browserErrors, []);
    assert.ok(requests.every(request => request.allowed), "Only GET requests to the owned loopback fixture are permitted");
  } catch (error) {
    process.exitCode = 1;
    if (active) { active.status = "fail"; active.error = error.stack ?? String(error); }
    if (page && !page.isClosed()) {
      try {
        if (active) active.failureState = await state();
        await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true });
      } catch (diagnosticError) { browserErrors.push(`Failure diagnostics: ${diagnosticError.message}`); }
    }
    console.error(error.stack ?? error);
  } finally {
    try { await ax?.detach(); } catch (error) { browserErrors.push(`CDP cleanup: ${error.message}`); }
    try { await browser?.close(); } catch (error) { browserErrors.push(`Browser cleanup: ${error.message}`); }
    try {
      if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } catch (error) { browserErrors.push(`Server cleanup: ${error.message}`); }
    if (browserErrors.length || cases.some(result => result.status !== "pass")) process.exitCode = 1;
    await fs.writeFile(path.join(out, "results.json"), JSON.stringify({
      status: process.exitCode ? "fail" : "pass", ...buildEvidence, syntheticOnly: true, productionAccess: false,
      networkPolicy: "GET-only owned loopback fixture", profile: path.join(out, "owned-chrome-profile"),
      nativeSizing: "100% browser zoom, DPR 1; desktop 1280x900 and mobile 390x844; no CSS zoom emulation",
      requests, browserErrors, cases, captures,
    }, null, 2));
    console.log(JSON.stringify({ out, status: process.exitCode ? "fail" : "pass", cases: cases.length, captures: captures.length, browserErrors }));
  }
}
