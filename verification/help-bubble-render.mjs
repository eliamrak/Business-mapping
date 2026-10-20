// Independent synthetic HelpBubble checks; no deployed URL, account, or persistent browser profile.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const dashboard = path.join(root, "artifacts/comp-dashboard");
const require = createRequire(path.join(root, "artifacts/api-server/package.json"));
const ts = createRequire(path.join(root, "package.json"))("typescript");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const harnessPath = fileURLToPath(import.meta.url);
const harnessHash = hash(await fs.readFile(harnessPath));
const out = process.env.PRACTICE_HELP_OUTPUT ?? await fs.mkdtemp("/tmp/practice-help-independent-");
await fs.mkdir(out, { recursive: true });
const sources = new Map();
async function readSource(relative) {
  const content = await fs.readFile(path.join(root, relative));
  sources.set(relative, hash(content));
  return content.toString();
}
function declaration(source, name) {
  const ast = ts.createSourceFile("component.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(result, `actual ${name} declaration exists`);
  return result;
}
const sandboxSource = await readSource("artifacts/comp-dashboard/src/components/sandbox-view.tsx");
const goalsSource = await readSource("artifacts/comp-dashboard/src/components/tabs/business-goals-tab.tsx");
const infoTip = declaration(sandboxSource, "InfoTip");
const numInput = declaration(goalsSource, "NumInput");
assert.match(infoTip, /return\s+<HelpBubble\s+text=\{text\}/);
assert.doesNotMatch(infoTip, /<span|TooltipTrigger/);
assert.match(numInput, /<Label htmlFor=\{name\}>\{label\}<\/Label>/);
assert.match(numInput, /<Input[\s\S]*?id=\{name\}/);
assert.match(numInput, /<HelpBubble text=\{tooltip\}/);
assert.doesNotMatch(numInput, /<Label[^>]*title=/);

const text = "Practice net equals billed session revenue minus clinician compensation and employer costs. Future revenue assumptions are separate from historical billed charges.";
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {HelpBubble} from '@/components/practice/help-bubble';
import {Label} from '@/components/ui/label';
import {Input} from '@/components/ui/input';
import {Tooltip,TooltipProvider,TooltipTrigger,TooltipContent} from '@/components/ui/tooltip';
import {Dialog,DialogTrigger,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
${infoTip}
${numInput}
window.helpEvidence={parentClicks:0,submits:0};
const text=${JSON.stringify(text)};
const parentClick=()=>window.helpEvidence.parentClicks++;
const submit=e=>{e.preventDefault();window.helpEvidence.submits++;};
function App(){return <main style={{minHeight:'100vh',padding:16}}>
<button id="before">Before help</button>
<form onSubmit={submit}><div onClick={parentClick} id="parent"><InfoTip text={text}/></div></form>
<button id="after" style={{marginTop:180}}>After help</button>
<TooltipProvider delayDuration={0}><Tooltip><TooltipTrigger asChild><button id="control" style={{marginLeft:80}}>Plain tooltip control</button></TooltipTrigger><TooltipContent>{text}</TooltipContent></Tooltip></TooltipProvider>
<Dialog><DialogTrigger asChild><button id="editor">Open compensation editor</button></DialogTrigger>
<DialogContent><DialogTitle>Compensation target editor</DialogTitle><DialogDescription>Synthetic editor</DialogDescription>
<form onSubmit={submit}><div onClick={parentClick}>
<NumInput label="Desired owner clinical caseload" name="desired-caseload" value={12} onChange={()=>{}} tooltip={text}/>
</div></form></DialogContent></Dialog></main>};
createRoot(document.getElementById('root')).render(<App/>);`;
await fs.writeFile(path.join(out, "fixture.tsx"), fixture);
const bundle = await require("esbuild").build({
  stdin: { contents: fixture, loader: "tsx", resolveDir: dashboard }, bundle: true,
  write: false, platform: "browser", format: "iife", jsx: "automatic",
  alias: { "@": path.join(dashboard, "src") }, define: { "process.env.NODE_ENV": '"test"' },
  plugins: [{ name: "pin-source-bytes", setup(builder) {
    builder.onLoad({ filter: /\.(tsx?|css)$/ }, async args => {
      if (!args.path.startsWith(root) || args.path.includes("/node_modules/")) return;
      const content = await fs.readFile(args.path);
      const relative = path.relative(root, args.path);
      const previous = sources.get(relative);
      if (previous) assert.equal(hash(content), previous, `${relative} changed before bundling`);
      sources.set(relative, hash(content));
      return { contents: content, loader: path.extname(args.path).slice(1), resolveDir: path.dirname(args.path) };
    });
  } }],
});
const javascript = bundle.outputFiles[0].text;
await fs.writeFile(path.join(out, "fixture.js"), javascript);
const builtIndex = await fs.readFile(path.join(dashboard, "dist/public/index.html"), "utf8");
const cssName = [...builtIndex.matchAll(/href=["'](?:[^"']*\/)?assets\/(index-[^"'/]+\.css)["']/g)][0]?.[1];
assert.ok(cssName, "existing utility stylesheet reference");
const cssPath = path.join(dashboard, "dist/public/assets", cssName);
const css = await fs.readFile(cssPath, "utf8");
const provenance = {
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  harnessSha256: harnessHash, fixtureSha256: hash(fixture), javascriptSha256: hash(javascript),
  utilityCss: { file: cssPath, sha256: hash(css) }, syntheticOnly: true,
  actualWrapperDeclarationsExtractedWithTypeScript: ["InfoTip", "NumInput"],
};
const { chromium } = createRequire(process.env.PRACTICE_PLAYWRIGHT_PACKAGE ?? "/tmp/practice-oct20-render-deps/package.json")("playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.PRACTICE_CHROMIUM_PATH ?? "/Users/eliam/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" });
const evidence = { provenance, cases: [], requests: [], errors: [] };
try {
  for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: true });
    page.setDefaultTimeout(10000);
    page.on("pageerror", error => evidence.errors.push(String(error)));
    await page.route("**/*", route => { evidence.requests.push(route.request().url()); return route.abort(); });
    await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><div id="root"></div>');
    await page.addScriptTag({ content: javascript });
    const outer = page.getByRole("button", { name: "Calculation help", exact: true });
    await outer.waitFor();
    const control = page.locator("#control");
    await control.hover();
    await page.getByRole("tooltip").waitFor({ state: "visible" });
    await page.locator("#before").hover();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const beforeBox = await page.locator("#before").boundingBox();
    await page.mouse.move(beforeBox.x + 2, beforeBox.y + 2, { steps: 3 });
    await page.waitForTimeout(200);
    const plainTooltipPersists = await page.getByRole("tooltip").count() > 0;
    await control.focus();
    await page.locator("#before").focus();
    await page.getByRole("tooltip").waitFor({ state: "hidden" });
    async function visibleBounds(locator) {
      await locator.waitFor({ state: "visible" });
      await locator.evaluate(async () => {
        await Promise.all(document.getAnimations().filter(animation => animation.playState === "running").map(animation => animation.finished.catch(() => {})));
      });
      assert.ok((await locator.textContent()).includes(text), "full methodology text exists");
      const bounds = await locator.evaluate(node => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width,
          scroll: node.scrollWidth, client: node.clientWidth, opacity: style.opacity };
      });
      assert.ok(bounds.left >= -1 && bounds.right <= width + 1, `help stays inside ${width}px: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.top >= -1 && bounds.bottom <= 901, "help vertically visible");
      assert.ok(bounds.scroll <= bounds.client + 1, "methodology text is not clipped horizontally");
      assert.equal(bounds.opacity, "1", "methodology has finished opening and is visibly opaque");
      return bounds;
    }
    async function exercise(button, nested) {
      const name = await button.getAttribute("aria-label");
      const popover = page.getByRole("dialog", { name, exact: true });
      const tooltip = page.getByRole("tooltip");
      assert.equal(await button.getAttribute("type"), "button");
      await button.evaluate(async node => {
        const animations = document.getAnimations().filter(animation => animation.playState === "running");
        await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
      });
      const size = await button.boundingBox();
      assert.ok(size.width >= 31.9 && size.height >= 31.9, `32px native help button: ${JSON.stringify(size)}`);
      assert.equal(await popover.count(), 0, "methodology starts collapsed");
      await button.hover();
      await tooltip.waitFor({ state: "visible" });
      // Radix exposes an invisible accessible tooltip node inside the visible content.
      const hoverBounds = await visibleBounds(tooltip.locator("xpath=.."));
      // Popper can put content above or below the trigger; select an actually uncovered point.
      const pointer = await page.evaluate(({ nested, name }) => {
        const trigger = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === name);
        const tooltip = document.querySelector('[role=tooltip]')?.parentElement;
        const area = nested ? [...document.querySelectorAll('[role=dialog]')].find(node => node.getAttribute('aria-labelledby')) : document.querySelector('main');
        const box = area.getBoundingClientRect();
        for (const y of [box.top + 8, box.bottom - 8, box.top + box.height / 2]) {
          for (const x of [box.left + 8, box.right - 8, box.left + box.width / 2]) {
            const hit = document.elementFromPoint(x, y);
            if (hit && area.contains(hit) && !trigger.contains(hit) && !tooltip?.contains(hit)) return { x, y };
          }
        }
        throw Error('No uncovered pointer-exit point in active fixture');
      }, { nested, name });
      await page.mouse.move(pointer.x, pointer.y, { steps: 3 });
      // Reset focus without Escape: an unhandled Escape would dismiss the outer Dialog.
      // Hover does not focus the trigger. Explicitly focus then blur it to test dismissal.
      await button.focus();
      if (nested) await page.locator("#desired-caseload").focus();
      else await page.locator("#before").focus();
      // Radix installs its pointer-grace listener in an effect after pointerleave.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.mouse.move(pointer.x + 1, pointer.y, { steps: 3 });
      await fs.writeFile(path.join(out, `hover-exit-${width}-${nested}.json`), JSON.stringify(await page.evaluate(pointer => ({pointer,hit:document.elementFromPoint(pointer.x,pointer.y)?.outerHTML,active:document.activeElement?.outerHTML,buttons:[...document.querySelectorAll('button[aria-haspopup=dialog]')].map(n=>({label:n.getAttribute('aria-label'),hover:n.matches(':hover')})),hovered:[...document.querySelectorAll(':hover')].map(n=>n.outerHTML.slice(0,300)),tooltips:[...document.querySelectorAll('[role=tooltip]')].map(n=>({node:n.outerHTML,parent:n.parentElement.outerHTML,bounds:n.parentElement.getBoundingClientRect().toJSON()}))}),pointer),null,2));
      await tooltip.waitFor({ state: "hidden" });
      if (nested) assert.equal(await page.getByRole("dialog", { name: "Compensation target editor", exact: true }).isVisible(), true, "hover transition preserves outer editor");
      if (!nested) { await page.locator("#before").focus(); await page.keyboard.press("Tab"); }
      else { await page.locator("#desired-caseload").focus(); await page.keyboard.press("Shift+Tab"); }
      await button.evaluate(node => { if (document.activeElement !== node) throw Error("help unreachable by Tab"); });
      await tooltip.waitFor({ state: "visible" });
      await visibleBounds(tooltip.locator("xpath=.."));
      for (const key of ["Enter", "Space"]) {
        await page.keyboard.press(key);
        await visibleBounds(popover);
        await popover.click();
        assert.deepEqual(await page.evaluate(() => window.helpEvidence), { parentClicks: 0, submits: 0 }, "help click does not bubble or submit");
        await page.keyboard.press("Escape");
        await popover.waitFor({ state: "hidden" });
        await button.evaluate(node => { if (document.activeElement !== node) throw Error("Escape failed to return trigger focus"); });
      }
      await button.tap();
      const tapBounds = await visibleBounds(popover);
      await button.tap();
      await popover.waitFor({ state: "hidden" });
      assert.deepEqual(await page.evaluate(() => window.helpEvidence), { parentClicks: 0, submits: 0 });
      evidence.cases.push({ width, nestedDialog: nested, name, hoverBounds, tapBounds, plainTooltipPersistsAfterPointerExit: plainTooltipPersists,
        tabFocusTooltip: true, enterSpacePopover: true, escapeReturnsFocus: true, tapToggle: true, noParentClickOrSubmit: true });
    }
    await exercise(outer, false);
    await page.locator("#editor").click();
    const editor = page.getByRole("dialog", { name: "Compensation target editor", exact: true });
    await editor.waitFor();
    const input = editor.getByLabel("Desired owner clinical caseload", { exact: true });
    assert.equal(await input.getAttribute("id"), "desired-caseload");
    await exercise(editor.getByRole("button", { name: "About Desired owner clinical caseload", exact: true }), true);
    assert.equal(await editor.isVisible(), true, "popover Escape leaves editor open");
    const help = editor.getByRole("button", { name: "About Desired owner clinical caseload", exact: true });
    await help.tap();
    await visibleBounds(page.getByRole("dialog", { name: "About Desired owner clinical caseload", exact: true }));
    await page.screenshot({ path: path.join(out, `dialog-help-${width}.png`) });
    await page.keyboard.press("Escape");
    assert.equal(await editor.isVisible(), true);
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(geometry.scroll <= geometry.client + 1, "no page overflow");
    await page.close();
  }
  assert.deepEqual(evidence.requests, [], "all rendering is local in-memory");
  assert.deepEqual(evidence.errors, []);
  for (const [file, before] of sources) assert.equal(hash(await fs.readFile(path.join(root, file))), before, `${file} changed during review`);
  assert.equal(hash(await fs.readFile(harnessPath)), harnessHash, "harness stable during review");
  assert.equal(hash(await fs.readFile(cssPath)), provenance.utilityCss.sha256);
  evidence.sourceHashes = Object.fromEntries([...sources].sort());
  evidence.screenshotHashes = Object.fromEntries(await Promise.all((await fs.readdir(out)).filter(name => name.endsWith(".png")).map(async name => [name, hash(await fs.readFile(path.join(out, name)))])));
  evidence.passed = true;
  await fs.writeFile(path.join(out, "results.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ out, passed: true, cases: evidence.cases.length, sourceHashes: evidence.sourceHashes }, null, 2));
} catch (error) {
  await fs.writeFile(path.join(out, "failure.json"), JSON.stringify({ ...evidence, sourceHashes: Object.fromEntries(sources), error: String(error.stack ?? error) }, null, 2));
  console.error(JSON.stringify({ out, passed: false, error: String(error.stack ?? error) }, null, 2));
  process.exitCode = 1;
} finally { await browser.close(); }
