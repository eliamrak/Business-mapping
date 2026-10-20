// Bounded follow-up: hydrated LeadFlow/field help and native disclosures from actual SSR markup.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const dash = path.join(root, "artifacts/comp-dashboard");
const require = createRequire(path.join(root, "artifacts/api-server/package.json"));
const ts = createRequire(path.join(root, "package.json"))("typescript");
const sha = content => createHash("sha256").update(content).digest("hex");
const out = process.env.PRACTICE_ADDED_HELP_OUTPUT ?? await fs.mkdtemp("/tmp/practice-help-added-");
await fs.mkdir(out, { recursive: true });
const ownPath = fileURLToPath(import.meta.url), ownHash = sha(await fs.readFile(ownPath));
const sources = new Map();
const files = ["components/tabs/team-builder-tab.tsx", "components/tabs/current-reality-tab.tsx", "components/tabs/scenario-builder-tab.tsx", "components/practice/lead-flow.tsx", "components/practice/workspace-calculations.tsx", "components/practice/local-retention-workspace.tsx"];
const sourceText = {};
const parse = source => ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findFunction(source, name) {
  const ast = parse(source); let result;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(ast); ts.forEachChild(node, visit); }
  visit(ast); assert.ok(result, name); return result;
}
function eventHandlers(source) {
  const ast = parse(source), handlers = [];
  function visit(node) {
    if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(ast))) handlers.push(node.getText(ast).replace(/\s+/g, " "));
    ts.forEachChild(node, visit);
  }
  visit(ast); return handlers.sort();
}
for (const file of files) {
  const relative = "artifacts/comp-dashboard/src/" + file;
  const source = await fs.readFile(path.join(root, relative), "utf8");
  sources.set(relative, sha(source)); sourceText[file] = source;
  const previous = execFileSync("git", ["show", "8aa7c934:" + relative], { cwd: root, encoding: "utf8" });
  assert.deepEqual(eventHandlers(source), eventHandlers(previous), `${file}: all original JSX event handlers unchanged`);
  assert.equal(parse(source).parseDiagnostics.length, 0, `${file}: JSX is syntactically balanced`);
}
const helpers = files.slice(0, 3).map((file, index) => {
  const declaration = findFunction(sourceText[file], "NumField");
  assert.match(declaration, /<Label htmlFor=\{name\}>\{label\}<\/Label>/);
  assert.match(declaration, /<HelpBubble text=\{tooltip\}/);
  assert.doesNotMatch(declaration, /<Label[^>]*title=/);
  return declaration.replace("function NumField(", `function Field${index}(`);
});
const lead = sourceText[files[3]];
const staffDialog = findFunction(sourceText[files[0]], "StaffMemberDialog");
for (const id of ["staff-employer-fica", "staff-other-burden"]) {
  assert.ok(staffDialog.includes(`htmlFor="${id}"`));
  assert.ok(staffDialog.includes(`id="${id}"`));
}
assert.doesNotMatch(staffDialog, /<Label[^>]*title=/);
assert.equal([...lead.matchAll(/<RateLabel name=/g)].length, 16, "all sixteen original rate captions delegate to shared definitions");
for (const definition of ["Scheduled consults divided by leads", "Attended consults divided by scheduled consults", "Clients booked divided by attended consults", "Clients booked divided by leads"]) assert.equal(lead.split(definition).length - 1, 1, `one shared ${definition}`);
const common = `import React,{useState} from 'react';
import {emptyWorkspace,periodSchema,funnelSchema} from '@workspace/practice/hub';
import {estimateLocalClientActivity} from '@/lib/retention-local';
const noop=()=>{};
const month=new Date().toLocaleDateString('en-CA').slice(0,7);
const workspace=emptyWorkspace(month+'-01');
const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
const period=periodSchema.parse({id:'11111111-1111-4111-8111-111111111111',name:'Synthetic month',start:month+'-01',end,status:'draft'});
workspace.periods.push(period);
workspace.funnels.push(funnelSchema.parse({id:'22222222-2222-4222-8222-222222222222',periodId:period.id,scope:'practice',spend:null,firstSessions:null,leads:40,scheduled:24,attended:20,clients:10}));
const sourceWorkspace=structuredClone(workspace);
sourceWorkspace.funnels[0]={...sourceWorkspace.funnels[0],scope:'source',sourceName:'Synthetic referral',clinicianId:1};
const context={clinicians:[{id:1,label:'Synthetic',goalId:null,sessionRate:150,sessionsPerWeek:20,weeksWorkedPerYear:48,capEnabled:false,capAmount:0,classification:'1099',preCapClinicianSplit:60,preCapPracticeSplit:40,postCapClinicianSplit:60,postCapPracticeSplit:40,w2EmployerFicaPct:0,futaSutaPct:0,workersCompPct:0,otherEmployerBurdenPct:0}],staff:[],sessions:[]};
const attendance={id:'synthetic-attendance',kind:'attendance',sourceHash:'attendance',importedAt:'2026-11-30T12:00:00Z',coverageStart:'2026-06-01',coverageEnd:'2026-11-30',reportCoverage:{start:'2026-06-01',end:'2026-11-30',complete:true},rows:['2026-07-02','2026-07-09','2026-07-16'].map((serviceDate,i)=>({clientId:'Synthetic client',clinician:'Synthetic',serviceDate,status:'show',billingCode:'90837',location:null,sourceRowHash:'show-'+i}))};
const billing={...attendance,id:'synthetic-billing',kind:'billing',sourceHash:'billing',rows:[{clientId:'Synthetic client',clinician:'Synthetic',serviceDate:'2026-07-02',billingCode:'90837',totalFeeCharged:50,sourceRowHash:'bill1'},{clientId:'Synthetic client',clinician:'Synthetic',serviceDate:'2026-07-02',billingCode:'90837',totalFeeCharged:125,sourceRowHash:'bill2'},{clientId:'Synthetic phone',clinician:'Synthetic',serviceDate:'2026-07-03',billingCode:'PHONE',totalFeeCharged:5,sourceRowHash:'phone'}]};
const snapshots=[attendance,billing];
const activity=estimateLocalClientActivity([attendance],{},56,56,28,'2026-11-30',90);
const flowProps={context,readOnly:true,pending:false,canSave:false,onSaveEntry:noop,onSaveBulk:noop,onCompleteMonth:noop,onPatch:noop,onRemove:noop,onSave:noop,onOpenPeriods:noop,onEditDetails:noop,onAddCorrection:noop};
`;
const client = `${common}
import {createRoot} from 'react-dom/client';
import LeadFlow from '@/components/practice/lead-flow';
import {HelpBubble} from '@/components/practice/help-bubble';
import {Label} from '@/components/ui/label';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter} from '@/components/ui/dialog';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Textarea} from '@/components/ui/textarea';
import {calculateStaffMemberCost} from '@/lib/calculations';
import {formatCurrency} from '@/lib/format';
${helpers.join("\n")}
${staffDialog}
window.staffCalls={save:0,close:0};
const initialStaff={label:'Synthetic staff',roleType:'admin',classification:'w2',annualSalary:45000,hourlyRate:null,hoursPerWeek:null,weeksPerYear:52,w2EmployerFicaPct:7.65,futaSutaPct:1,workersCompPct:0.5,otherEmployerBurdenPct:0,notes:'',payMode:'salary'};
function StaffFixture(){const [open,setOpen]=useState(false);return <><button id="staff-editor" onClick={()=>setOpen(true)}>Open staff editor</button>{open&&<StaffMemberDialog open={open} title="Synthetic staff editor" initial={initialStaff} onClose={()=>{window.staffCalls.close++;setOpen(false);}} onSave={()=>window.staffCalls.save++} saving={false}/>}</>;}
function App(){return <main style={{padding:16,minHeight:'100vh',maxWidth:'100%'}}><div id="fields">{[Field0,Field1,Field2].map((C,i)=><C key={i} name={'field-'+i} label={'Synthetic field '+i} value={12} onChange={noop} tooltip={'Definition for field '+i}/>)}</div><div id="practice"><LeadFlow workspace={workspace} {...flowProps}/></div><div id="source"><LeadFlow workspace={sourceWorkspace} {...flowProps}/></div><StaffFixture/></main>};
window.fixtureBefore=JSON.stringify({workspace,sourceWorkspace,context});
window.fixtureUnchanged=()=>window.fixtureBefore===JSON.stringify({workspace,sourceWorkspace,context});
createRoot(document.getElementById('root')).render(<App/>);`;
const server = `${common}
import {renderToStaticMarkup} from 'react-dom/server';
import WorkspaceCalculations from '@/components/practice/workspace-calculations';
import LocalRetentionWorkspace from '@/components/practice/local-retention-workspace';
const state={billingResolutions:[],setBillingResolutions:noop,billingResolutionRevision:0,setBillingResolutionRevision:noop,declarations:null,setDeclarations:noop,packages:[],setPackages:noop,snapshots,setSnapshots:noop,billingCodeMinutes:{},setBillingCodeMinutes:noop,sameDayVisitOverrides:{},setSameDayVisitOverrides:noop,codeDraft:{code:'',minutes:''},setCodeDraft:noop,status:'Synthetic imports',setStatus:noop,error:'',setError:noop,busy:false,setBusy:noop,pending:null,setPending:noop};
export const html=renderToStaticMarkup(<main style={{padding:16}}><WorkspaceCalculations workspace={workspace} context={context} clientActivityEstimate={activity} onSetting={noop}/><LocalRetentionWorkspace workspaceState={state} roster={context.clinicians} today="2026-11-30"/></main>);`;
async function build(contents, platform) {
  return require("esbuild").build({ stdin: { contents, loader: "tsx", resolveDir: dash }, bundle: true, write: false, platform, format: platform === "node" ? "cjs" : "iife", jsx: "automatic", alias: { "@": path.join(dash, "src") }, define: { "process.env.NODE_ENV": '"test"', "import.meta.env": '{}' }, plugins: [{ name: "hash-runtime", setup(builder) {
    builder.onLoad({ filter: /\.(tsx?|css)$/ }, async args => {
      if (!args.path.startsWith(root) || args.path.includes("/node_modules/")) return;
      const bytes = await fs.readFile(args.path), relative = path.relative(root, args.path);
      if (sources.has(relative)) assert.equal(sha(bytes), sources.get(relative), relative + " stable before bundle");
      sources.set(relative, sha(bytes));
      return { contents: bytes, loader: path.extname(args.path).slice(1), resolveDir: path.dirname(args.path) };
    });
  } }] });
}
await fs.writeFile(path.join(out, "fixture.tsx"), client);
const browserBundle = (await build(client, "browser")).outputFiles[0].text;
const compiled = { exports: {} };
new Function("module", "exports", "require", (await build(server, "node")).outputFiles[0].text)(compiled, compiled.exports, require);
const html = compiled.exports.html;
await fs.writeFile(path.join(out, "disclosures-ssr.html"), html);
const index = await fs.readFile(path.join(dash, "dist/public/index.html"), "utf8");
const cssName = [...index.matchAll(/href=["'](?:[^"']*\/)?assets\/(index-[^"'/]+\.css)["']/g)][0]?.[1];
assert.ok(cssName);
const cssPath = path.join(dash, "dist/public/assets", cssName), css = await fs.readFile(cssPath, "utf8"), cssHash = sha(css);
const { chromium } = createRequire(process.env.PRACTICE_PLAYWRIGHT_PACKAGE ?? "/tmp/practice-oct20-render-deps/package.json")("playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.PRACTICE_CHROMIUM_PATH ?? "/Users/eliam/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" });
const evidence = { head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), checks: [], requests: [], errors: [], harnessSha256: ownHash, css: { path: cssPath, hash: cssHash }, sourceHandlersUnchanged: files };
try {
 for (const width of [1280, 390, 320]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: true }); page.setDefaultTimeout(10000);
  page.on("pageerror", error => evidence.errors.push(String(error)));
  await page.route("**/*", route => { evidence.requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><div id="root"></div>');
  await page.addScriptTag({ content: browserBundle });
  for (const id of ["practice", "source"]) await page.locator("#" + id).getByRole("button", { name: "Month details", exact: true }).click();
  const definitions = { "Schedule rate": "Scheduled consults divided by leads", "Show rate": "Attended consults divided by scheduled consults", "Consult close rate": "Clients booked divided by attended consults", "Overall close rate": "Clients booked divided by leads" };
  async function assertContent(locator, expected) {
    await locator.waitFor({ state: "visible" });
    await locator.evaluate(async () => Promise.all(document.getAnimations().filter(a => a.playState === "running").map(a => a.finished.catch(() => {}))));
    assert.ok((await locator.textContent()).includes(expected));
    const bounds = await locator.evaluate(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, opacity: getComputedStyle(node).opacity, client: node.clientWidth, scroll: node.scrollWidth }; });
    assert.ok(bounds.left >= -1 && bounds.right <= width + 1, JSON.stringify(bounds)); assert.equal(bounds.opacity, "1"); assert.ok(bounds.scroll <= bounds.client + 1);
  }
  async function checkHelp(button, expected) {
    await button.scrollIntoViewIfNeeded();
    const name = await button.getAttribute("aria-label"), tip = page.getByRole("tooltip"), pop = page.getByRole("dialog", { name, exact: true });
    await button.hover(); await tip.waitFor({ state: "visible" }); await assertContent(tip.locator("xpath=.."), expected);
    await button.focus(); await page.keyboard.press("Escape"); await tip.waitFor({ state: "hidden" });
    await button.evaluate(node => node.blur()); await button.focus(); await tip.waitFor({ state: "visible" }); await assertContent(tip.locator("xpath=.."), expected);
    await page.keyboard.press("Enter"); await assertContent(pop, expected);
    await page.keyboard.press("Escape"); await pop.waitFor({ state: "hidden" });
    await button.evaluate(node => { if (document.activeElement !== node) throw Error("help focus not restored"); });
    await button.tap(); await assertContent(pop, expected); await button.tap(); await pop.waitFor({ state: "hidden" });
  }
  for (let i = 0; i < 3; i++) {
    const input = page.getByLabel("Synthetic field " + i, { exact: true }); assert.equal(await input.getAttribute("id"), "field-" + i);
    await checkHelp(page.getByRole("button", { name: "About Synthetic field " + i, exact: true }), "Definition for field " + i);
  }
  for (const [name, definition] of Object.entries(definitions)) {
    const practiceButton = page.locator("#practice .pw-lead-flow-result").getByRole("button", { name: "About " + name, exact: true });
    await checkHelp(practiceButton, definition);
    for (const selector of ["#source .pw-lead-flow-table", "#source .pw-lead-flow-totals", "#source .pw-lead-flow-people"]) {
      assert.equal(await page.locator(selector).getByRole("button", { name: "About " + name, exact: true }).count(), 1);
    }
  }
  assert.match(await page.locator("#practice .pw-lead-flow-result").innerText(), /60%[\s\S]*83%[\s\S]*50%[\s\S]*25%/);
  assert.equal(await page.evaluate(() => window.fixtureUnchanged()), true);
  await page.screenshot({ path: path.join(out, `lead-field-help-${width}.png`), fullPage: true });
  evidence.checks.push({ width, hydratedFieldHelpers: 3, hydratedRateDefinitions: 4, sourceHeaderTotalsClinicianDefinitions: 12, rates: [60, 83, 50, 25], sourceFactsUnchanged: true });
  await page.locator("#staff-editor").click();
  const staff = page.getByRole("dialog", { name: "Synthetic staff editor", exact: true });
  await staff.waitFor();
  for (const [id, label, help, definition, value] of [
    ["staff-employer-fica", "Employer FICA (%)", "Employer FICA help", "Employer's share of Social Security & Medicare (7.65%)", "7.65"],
    ["staff-other-burden", "Other Burden (%)", "Other Burden help", "Health insurance, retirement match, or other benefits", "0"],
  ]) {
    const input = staff.getByLabel(label, { exact: true }), button = staff.getByRole("button", { name: help, exact: true });
    assert.equal(await input.getAttribute("id"), id); assert.equal(await input.inputValue(), value);
    await checkHelp(button, definition);
    await input.focus(); await page.keyboard.press("Shift+Tab");
    await button.evaluate(node => { if (document.activeElement !== node) throw Error("staff help unreachable by keyboard"); });
    assert.equal(await staff.isVisible(), true); assert.equal(await input.inputValue(), value);
    assert.deepEqual(await page.evaluate(() => window.staffCalls), { save: 0, close: 0 });
  }
  await page.screenshot({ path: path.join(out, `staff-dialog-${width}.png`) });
  await staff.getByRole("button", { name: "Close", exact: true }).click(); await staff.waitFor({ state: "hidden" });
  evidence.checks.push({ width, actualHydratedStaffMemberDialog: true, helpControls: ["staff-employer-fica", "staff-other-burden"], labelAssociation: true, hoverFocusEnterEscapeTouch: true, keyboardOrder: true, valuesUnchanged: true, noSaveOrPrematureClose: true });
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style>' + html);
  const titles = ["How visit frequency is calculated", "How client endings are calculated", "Import format and storage", "Coverage and billing definitions"];
  for (const title of titles) {
    const summary = page.locator("summary").filter({ hasText: new RegExp("^" + title + "$") }), details = summary.locator("..");
    assert.equal(await summary.count(), 1, title); assert.equal(await details.getAttribute("open"), null);
    const body = details.locator(":scope > p").first(); assert.equal(await body.isVisible(), false);
    await summary.focus(); await page.keyboard.press("Enter"); assert.equal(await body.isVisible(), true);
    await page.keyboard.press("Space"); assert.equal(await body.isVisible(), false);
    await summary.tap(); assert.equal(await body.isVisible(), true); await summary.tap(); assert.equal(await body.isVisible(), false);
  }
  const coverage = page.getByRole("region", { name: "Verified complete report coverage" });
  assert.ok(await coverage.getByText(/raw rows excluded from eligible metrics/).isVisible());
  assert.ok(await coverage.getByText(/Billing source review:/).isVisible());
  assert.ok(await coverage.getByRole("alert").filter({ hasText: /PHONE charge review:/ }).isVisible());
  await page.screenshot({ path: path.join(out, `native-disclosures-${width}.png`), fullPage: true });
  evidence.checks.push({ width, actualSsrNativeDisclosures: titles, conflictAndPhoneWarningsVisible: true, syntheticOnly: true, hydratedImportHandlersClaimed: false });
  await page.close();
 }
 assert.deepEqual(evidence.requests, []); assert.deepEqual(evidence.errors, []);
 for (const [file, before] of sources) assert.equal(sha(await fs.readFile(path.join(root, file))), before, file + " stable during review");
 assert.equal(sha(await fs.readFile(ownPath)), ownHash); assert.equal(sha(await fs.readFile(cssPath)), cssHash);
 evidence.sourceHashes = Object.fromEntries([...sources].sort()); evidence.passed = true;
 evidence.screenshotHashes = Object.fromEntries(await Promise.all((await fs.readdir(out)).filter(file => file.endsWith(".png")).map(async file => [file, sha(await fs.readFile(path.join(out, file)))])));
 await fs.writeFile(path.join(out, "results.json"), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ out, passed: true, checks: evidence.checks }, null, 2));
} catch (error) {
 await fs.writeFile(path.join(out, "failure.json"), JSON.stringify({ ...evidence, sourceHashes: Object.fromEntries(sources), error: String(error.stack ?? error) }, null, 2)); console.error(JSON.stringify({ out, passed: false, error: String(error.stack ?? error) }, null, 2)); process.exitCode = 1;
} finally { await browser.close(); }
