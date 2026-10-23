import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { root, git, mobileBase, workspaceFile, mobileComponentFile, mobileCssFile, assertMobileWorkspace, mobileAllowedFiles, financialAllowedFiles, publisherHistoryFiles, reviewedMobileReadiness, assertReviewedMobileReadiness } from "./mobile-shell-source-contract.mjs";

const read = file => fs.readFileSync(path.join(root, file), "utf8");
const require = createRequire(path.join(root, "artifacts/comp-dashboard/package.json"));
const ts = require("typescript");
const postcss = createRequire(require.resolve("vite/package.json"))("postcss");

test("stripping literal mobile shell additions and two financial props restores exact approved 72dc5fb workspace bytes", () => {
  assertMobileWorkspace(read(workspaceFile));
});

test("source contract rejects existing logic mutations and duplicate mobile fragments", () => {
  const source = read(workspaceFile);
  assert.throws(() => assertMobileWorkspace(source.replace("async function navigate(next: Mode)", "async function navigate(next: never)")));
  assert.throws(() => assertMobileWorkspace(source.replace("setIntegratedTool(next);", "setIntegratedTool(null);")));
  const importLine = source.split("\n").find(line => line.includes('from "@/components/practice/mobile-workspace-controls"'));
  assert.ok(importLine);
  assert.throws(() => assertMobileWorkspace(importLine + "\n" + source));
  assert.throws(() => assertMobileWorkspace(source.replace("estimatedBudgetMonth={currentMoneyPlanning?.budgetEstimate}", "estimatedBudgetMonth={undefined}")));
  assert.throws(() => assertMobileWorkspace(source + '\nconst unrelatedFinancialChange = true;\n'));
});

test("all cumulative changes since approved mobile base use exact reviewed paths", () => {
  const changes = [...git("diff", mobileBase, "--name-only", "-z").split("\0"), ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0")].filter(Boolean);
  const unexpected = files => files.filter(file => !mobileAllowedFiles.has(file) && !financialAllowedFiles.has(file) && !publisherHistoryFiles.has(file) && !reviewedMobileReadiness.has(file));
  for (const file of changes.filter(file => reviewedMobileReadiness.has(file))) {
    assertReviewedMobileReadiness(file, fs.readFileSync(path.join(root, file)));
  }
  assert.deepEqual([...publisherHistoryFiles].sort(), [".agents/memory/MEMORY.md", ".agents/memory/release-evidence-temp-files.md"].sort());
  assert.deepEqual(unexpected([...publisherHistoryFiles]), [], "Only the two established publisher-history paths are exempt");
  const rejected = [".agents/memory/OTHER.md", ".agents/memory/MEMORY.md.extra", ".agents/memory/release-evidence-temp-files.md/child", "artifacts/api-server/src/routes/practiceImports.ts", "artifacts/comp-mobile/server/serve.js.extra", "verification/mobile-readiness-other.test.cjs", "artifacts/comp-dashboard/src/lib/unreviewed-financial.ts", "lib/practice/src/hub/engine.ts"];
  assert.deepEqual(unexpected(rejected), rejected, "No memory directory, prefix or runtime exemption");
  assert.deepEqual(unexpected(changes), [], "No API, domain, dependency, data, shared UI, existing CSS or other source changes are authorized");
});

test("prior mobile readiness exception is exact-path and exact-hash only", () => {
  assert.deepEqual([...reviewedMobileReadiness], [
    ["artifacts/comp-mobile/server/serve.js", "d0161767d8de2ed7320e982faa5e484ad455bbe3cc2a18dea591567320c78be4"],
    ["verification/OCTOBER22-MOBILE-READINESS-RECEIPT.md", "1ffa0d30c418575dfff1a8b001bf731df1b57781b9d13f95145db872d0d189ae"],
    ["verification/mobile-readiness.test.cjs", "794a0f9fa5b8a8e18fae4270b712d312e449c4c74a0bb123c2ee42669d42aab1"],
  ]);
  for (const file of reviewedMobileReadiness.keys()) {
    assert.throws(() => assertReviewedMobileReadiness(file, Buffer.from("unapproved readiness bytes")), /Reviewed mobile readiness bytes changed/);
  }
  assert.throws(() => assertReviewedMobileReadiness("artifacts/comp-mobile/server/other.js", Buffer.from("unapproved")), /Unreviewed readiness path/);
});

test("independent financial probe reconciles daily costs, isolates cloned source basis and leaves unrelated events/payroll intact", async () => {
  const { emptyWorkspace, budgetSchema, categorySchema, clinicianSettingSchema, eventSchema } = await import(require.resolve("@workspace/practice/hub"));
  const { moneyPlanningForecast } = await import("../artifacts/comp-dashboard/src/lib/money-planning-forecast.ts");
  const { profitFirstPlanning } = await import("../artifacts/comp-dashboard/src/lib/profit-first-planning.ts");
  const workspace = emptyWorkspace("2026-10-01");
  Object.assign(workspace.settings, { teamId: 7, defaultInPersonPct: 0, collectionPct: 100, processingPct: 0,
    processingFixedPerTransaction: 0, overheadFloorMonthly: 0 });
  const clinician = { id: 1, goalId: 7, label: "Independent synthetic clinician", classification: "1099", sessionRate: 100,
    sessionsPerWeek: 7, weeksWorkedPerYear: 52.1786, capEnabled: false, capAmount: 0,
    preCapClinicianSplit: 60, preCapPracticeSplit: 40, postCapClinicianSplit: 60, postCapPracticeSplit: 40,
    w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 };
  const context = { staff: [], clinicians: [clinician], sessions: [{ id: -1, clinicianId: 1, start: "2026-10-21", end: "2026-10-21",
    completed: 14, desired: 0, scheduled: null, cancelled: null, noShow: null, inPerson: null, telehealth: null, sourceAttachmentId: null }] };
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2026-10-16", desiredWeeklySessions: 7, inPersonPct: 0 }));
  const category = categorySchema.parse({ id: crypto.randomUUID(), name: "Independent costs", kind: "expense" });
  workspace.categories.push(category);
  workspace.budgets.push(
    budgetSchema.parse({ id: crypto.randomUUID(), categoryId: category.id, name: "Independent session cost", amount: 15, cadence: "per_session", start: "2026-10-16" }),
    budgetSchema.parse({ id: crypto.randomUUID(), categoryId: category.id, name: "Independent revenue cost", amount: 12.5, cadence: "percent_revenue", start: "2026-10-16" }));
  workspace.events.push(eventSchema.parse({ id: crypto.randomUUID(), name: "Unrelated note", field: "custom", date: "2026-10-01", value: 0 }));
  const coverage = [{ clinicianId: 1, start: "2026-10-08", end: "2026-10-21" }];
  const original = structuredClone({ workspace, context, coverage });
  const report = moneyPlanningForecast(workspace, context, "2026-10-23", coverage);
  const basis = report.budgetEstimate;
  assert.ok(basis);
  assert.notEqual(basis.budgets, workspace.budgets);
  assert.notEqual(basis.budgets[0], workspace.budgets[0]);
  assert.notEqual(basis.events, workspace.events);
  assert.notEqual(basis.events[0], workspace.events[0]);
  const input = { workspace, context, asOf: "2026-10-01", costSource: "budget", estimatedBudgetMonth: basis, estimatedMonthlyValues: { ...report.months[0].values } };
  const close = (actual, expected) => assert.ok(actual != null && Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
  const cost = result => result.costs.find(item => item.key === "overhead").monthly;
  close(report.months[0].values.sessions, 16);
  close(report.months[0].values.revenue, 1600);
  close(cost(profitFirstPlanning(input)), 440); // 16 * 15 + 1600 * 12.5%.
  const payroll = profitFirstPlanning(input).costs.filter(item => /Pay|Burden|staffCost/.test(item.key));
  assert.deepEqual({ workspace, context, coverage }, original);
  workspace.budgets[0].amount = 99;
  assert.equal(basis.budgets[0].amount, 15);
  assert.equal(cost(profitFirstPlanning(input)), null);
  workspace.budgets[0].amount = 15;
  workspace.events[0].notes = "Changed unrelated metadata";
  assert.notEqual(basis.events[0].notes, workspace.events[0].notes);
  close(cost(profitFirstPlanning(input)), 440);
  assert.deepEqual(profitFirstPlanning(input).costs.filter(item => /Pay|Burden|staffCost/.test(item.key)), payroll);
  input.estimatedBudgetMonth = undefined;
  assert.equal(cost(profitFirstPlanning(input)), null);
});

test("only hidden mobile controls and display-contents wrappers affect desktop CSS", () => {
  const ast = postcss.parse(read(mobileCssFile));
  const rules = ast.nodes.filter(node => node.type === "rule");
  assert.deepEqual(rules.map(rule => ({ selectors: rule.selectors, declarations: rule.nodes.map(d => [d.prop, d.value, !!d.important]) })), [
    { selectors: [".pw-mobile-toolbar", ".pw-mobile-actions-trigger", ".pw-mobile-contributor", ".pw-mobile-view-control"], declarations: [["display", "none", false]] },
    { selectors: [".pw-page-actions-shell", ".pw-page-actions-content"], declarations: [["display", "contents", false]] },
  ]);
  assert.ok(ast.nodes.every(node => node.type === "comment" || node.type === "rule" || node.type === "atrule" && node.name === "media" && node.params === "(max-width: 760px)"));
  ast.walkRules(rule => {
    assert.ok(rule.selectors.every(selector => /^\.pw-(?:app|mobile-|page-actions-)/.test(selector)), rule.selector);
    if (rule.parent !== ast) assert.equal(rule.parent.params, "(max-width: 760px)", rule.selector);
  });
  ast.walkDecls(decl => assert.ok(!/^(animation|transition)(-|$)/.test(decl.prop), "Portaled navigation is static, including reduced motion"));
});

// Execute real exported component bodies. Radix remains a named boundary here;
// browser focus trapping and portal behavior belong to the separate browser gate.
function harness(file = mobileComponentFile) {
  let cursor = 0;
  const slots = [], effects = [], listeners = new Map();
  const media = { matches: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); } };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useId() { const i = cursor++; return slots[i] ??= `mobile-test-${i}`; },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useEffect(fn) { const i = cursor++; effects[i] ??= { cleanup: fn() }; },
  };
  const exports = {};
  const dialog = Object.fromEntries(["Root", "Trigger", "Portal", "Overlay", "Content", "Title", "Description", "Close"].map(key => [key, `Dialog.${key}`]));
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const source = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, window: { matchMedia(query) { assert.equal(query, "(min-width: 761px)"); return media; } }, require(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "@radix-ui/react-dialog") return dialog;
    if (name === "lucide-react") return { Menu: "Menu", MoreHorizontal: "MoreHorizontal", X: "X" };
    if (name.endsWith(".css")) return {};
    throw Error(`Unexpected dependency: ${name}`);
  } }, { timeout: 1000 });
  return { exports, media, listeners,
    render(name, props) { cursor = 0; return exports[name](props); },
    resize(matches) { media.matches = matches; listeners.get("change")?.(); },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); },
  };
}

function nodes(tree, predicate, ancestors = []) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate, ancestors));
  return [...(predicate(tree) ? [{ node: tree, ancestors }] : []), ...nodes(tree.props?.children, predicate, [...ancestors, tree])];
}
const one = (tree, predicate) => { const matches = nodes(tree, predicate); assert.equal(matches.length, 1); return matches[0].node; };

test("modal navigation keeps every supplied destination, active/disabled state and safe reference link", () => {
  const h = harness();
  const selections = [];
  const make = (id, selected = false) => ({ id, label: id, selected, onSelect() { selections.push(id); } });
  const props = { name: "Synthetic Practice", disabled: false, modes: [make("Today", true), make("Long Term Goals"), make("Sandbox")], sections: [make("Overview"), make("Sessions"), make("Team"), make("Money"), make("Growth"), make("Goals")], utilities: [make("Data & imports"), make("Settings")], referenceHref: "/reference" };
  let tree = h.render("MobileWorkspaceNavigation", props);
  const dialog = one(tree, n => n.type === "Dialog.Root");
  assert.notEqual(dialog.props.modal, false, "Radix modal default must remain enabled");
  assert.equal(dialog.props.open, false);
  dialog.props.onOpenChange(true);
  tree = h.render("MobileWorkspaceNavigation", props);
  assert.equal(one(tree, n => n.type === "Dialog.Root").props.open, true);
  const destinations = nodes(tree, n => n.type === "button" && n.props.onClick);
  assert.equal(destinations.length, 11);
  assert.equal(destinations[0].node.props["aria-current"], "page");
  assert.ok(destinations.slice(1).every(({ node }) => node.props["aria-current"] === undefined));
  destinations.at(-1).node.props.onClick();
  assert.deepEqual(selections, ["Settings"]);
  assert.equal(one(h.render("MobileWorkspaceNavigation", props), n => n.type === "Dialog.Root").props.open, false);
  const link = one(tree, n => n.type === "a");
  assert.equal(link.props.href, "/reference");
  assert.equal(link.props.target, "_blank");
  assert.equal(link.props.rel, "noreferrer");
  tree = h.render("MobileWorkspaceNavigation", { ...props, disabled: true, referenceHref: undefined });
  assert.ok(nodes(tree, n => n.type === "button" && n.props.onClick).every(({ node }) => node.props.disabled));
  assert.equal(nodes(tree, n => n.type === "a").length, 0);
  assert.ok(one(tree, n => n.type === "Dialog.Title"));
  assert.ok(one(tree, n => n.type === "Dialog.Description"));
  assert.equal(one(tree, n => n.type === "Dialog.Close").props["aria-label"], "Close navigation");
  h.unmount();
});

test("portaled destination clicks use real unsaved guard; open and close controls do not prompt", () => {
  const guard = harness("artifacts/comp-dashboard/src/components/hub/use-unsaved.ts").exports.requiresUnsavedNavigationConfirm;
  const h = harness();
  const item = (id, selected = false) => ({ id, label: id, selected, onSelect() {} });
  const tree = h.render("MobileWorkspaceNavigation", { name: "Synthetic", disabled: false, modes: [item("Today", true), item("Sandbox")], sections: [item("Sessions")], utilities: [item("Settings")] });
  for (const { node, ancestors } of nodes(tree, n => n.type === "button" || n.type === "Dialog.Close")) {
    const marked = Object.hasOwn(node.props, "data-unsaved-navigation") || ancestors.some(n => Object.hasOwn(n.props, "data-unsaved-navigation"));
    const button = { disabled: node.props.disabled, getAttribute: name => node.props[name], closest: () => marked ? {} : null };
    const event = { button: 0, target: { closest: selector => selector === "button" ? button : null } };
    const isDestination = !!node.props.onClick;
    assert.equal(guard(event, "http://synthetic.invalid/"), isDestination && node.props["aria-current"] !== "page", node.props["aria-label"] ?? node.props.children);
    if (isDestination) assert.ok(ancestors.some(n => n.type === "nav" && Object.hasOwn(n.props, "data-unsaved-navigation")));
  }
  const source = read(workspaceFile);
  assert.match(source, /<header className="pw-rail pw-top-navigation" aria-label="Practice navigation">/);
  h.unmount();
});

test("navigation closes at desktop breakpoint and unregisters its resize listener", () => {
  const h = harness();
  const props = { name: "Synthetic", disabled: false, modes: [], sections: [], utilities: [] };
  let tree = h.render("MobileWorkspaceNavigation", props);
  one(tree, n => n.type === "Dialog.Root").props.onOpenChange(true);
  h.resize(false);
  assert.equal(one(h.render("MobileWorkspaceNavigation", props), n => n.type === "Dialog.Root").props.open, true);
  h.resize(true);
  assert.equal(one(h.render("MobileWorkspaceNavigation", props), n => n.type === "Dialog.Root").props.open, false);
  assert.equal(h.listeners.size, 1);
  h.unmount();
  assert.equal(h.listeners.size, 0);
});

test("page actions preserve existing commands; expanded state, Escape and focus return are wired", () => {
  const h = harness();
  const children = { type: "existing-actions", props: {} }, viewControl = { type: "existing-view-selector", props: {} };
  const props = { children, viewControl };
  let tree = h.render("MobilePageActions", props);
  let trigger = one(tree, n => n.type === "button");
  const id = trigger.props["aria-controls"];
  assert.equal(trigger.props["aria-expanded"], false);
  assert.equal(one(tree, n => n.props.id === id).props.className, "pw-page-actions-content");
  trigger.props.onClick();
  tree = h.render("MobilePageActions", props);
  trigger = one(tree, n => n.type === "button");
  assert.equal(trigger.props["aria-expanded"], true);
  assert.equal(trigger.props["aria-controls"], id);
  assert.equal(one(tree, n => n.props.id === id).props.className, "pw-page-actions-content pw-page-actions-content--open");
  assert.equal(one(tree, n => n.type === "existing-actions"), children);
  assert.equal(one(tree, n => n.type === "existing-view-selector"), viewControl);
  let focuses = 0, stops = 0;
  trigger.props.ref.current = { focus() { focuses++; } };
  tree.props.onKeyDown({ key: "Tab", stopPropagation() { stops++; } });
  assert.equal(focuses, 0);
  tree.props.onKeyDown({ key: "Escape", stopPropagation() { stops++; } });
  assert.equal(focuses, 1);
  assert.equal(stops, 1);
  assert.equal(one(h.render("MobilePageActions", props), n => n.type === "button").props["aria-expanded"], false);
});

test("native contributor selector retains roster order, label, selection and comparison callback", () => {
  const h = harness(), changed = [];
  let compares = 0;
  const props = { label: "Sessions clinician", names: ["Whole Practice", "Synthetic A", "Synthetic B"], value: "Synthetic B", onChange(name) { changed.push(name); }, onCompare() { compares++; } };
  let tree = h.render("MobileContributorSelect", props);
  let select = one(tree, n => n.type === "select");
  assert.equal(one(tree, n => n.type === "label").props.htmlFor, select.props.id);
  assert.equal(select.props.value, "Synthetic B");
  assert.deepEqual(nodes(tree, n => n.type === "option").map(({ node }) => node.props.value), [...props.names, "__compare__"]);
  select.props.onChange({ target: { value: "Synthetic A" } });
  select.props.onChange({ target: { value: "__compare__" } });
  assert.deepEqual(changed, ["Synthetic A"]);
  assert.equal(compares, 1);
  tree = h.render("MobileContributorSelect", { ...props, compare: true });
  assert.equal(one(tree, n => n.type === "select").props.value, "__compare__");
  tree = h.render("MobileContributorSelect", { ...props, onCompare: undefined });
  assert.deepEqual(nodes(tree, n => n.type === "option").map(({ node }) => node.props.value), props.names);
});
