import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import ts from "../node_modules/typescript/lib/typescript.js";
import * as hub from "../lib/practice/src/hub/index.ts";
import * as planner from "../artifacts/comp-dashboard/src/lib/profit-first-planning.ts";

const componentUrl = new URL("../artifacts/comp-dashboard/src/components/practice/profit-first-planning.tsx", import.meta.url);
const dashboardRequire = createRequire(new URL("../artifacts/comp-dashboard/package.json", import.meta.url));
const { renderToStaticMarkup } = dashboardRequire("react-dom/server");
const code = ts.transpileModule(readFileSync(componentUrl, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const fields = [
  { name: "revenue", label: "Monthly billed revenue estimate", previous: 10000, read: p => p.estimatedMonthlyValues.revenue },
  { name: "overhead", label: "Overhead set-aside estimate", previous: 1200, read: p => p.estimatedMonthlyValues.overhead },
  { name: "processing", label: "Processing cost estimate", previous: 100, read: p => p.estimatedMonthlyValues.fees },
  { name: "quarterly tax", label: "Quarterly tax planning estimate", previous: 1200, divisor: 3, maximum: 3e10, read: p => p.estimatedMonthlyValues.taxObligations },
  { name: "floor", label: "Business profit scenario percentage floor", previous: 150, read: p => p.scenarioPercents["business-profit"] },
  { name: "preset goal", label: "Building fund monthly contribution", previous: 250, read: p => p.goals.find(g => g.name === "Building fund monthly contribution").monthlyAmount },
  { name: "custom goal", label: "Custom reserve contribution", previous: 75, read: p => p.goals.find(g => g.name === "Custom reserve contribution").monthlyAmount },
];
const otherLabel = "Other monthly income estimate";
const event = (value, badInput = false) => ({ target: { value, validity: { badInput } } });
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function textContent(tree) {
  if (tree?.type === "input" && tree.props["aria-label"]?.endsWith("current allocation percentage")) return String(tree.props.value);
  if (Array.isArray(tree)) return tree.map(textContent).join("");
  if (tree === null || tree === undefined || typeof tree === "boolean") return "";
  return typeof tree === "object" ? textContent(tree.props?.children) : String(tree);
}
function rowCells(f, label) {
  const row = nodes(f.tree).find(n => n.type === "tr" && nodes(n).some(child => child.type === "th" && child.props.scope === "row" && textContent(child) === label));
  assert.ok(row, `Bucket row: ${label}`);
  return nodes(row).filter(n => n.type === "th" || n.type === "td").map(textContent);
}

// Run the actual TSX handlers and JSX runtime with deterministic hook state.
// This intentionally provides no DOM, native input sanitization, or React scheduler.
function fixture(configure = () => {}) {
  const workspace = hub.emptyWorkspace("2026-01-01");
  workspace.moneyPlanning = {
    estimatedMonthlyValues: { revenue: 10000, overhead: 1200, fees: 100, otherIncome: 0, taxObligations: 1200 },
    scenarioPercents: { "business-profit": 150 },
    goals: [
      { id: randomUUID(), name: "Building fund monthly contribution", bucket: "business-profit", mode: "additional", monthlyAmount: 250 },
      { id: randomUUID(), name: "Custom reserve contribution", bucket: "business-profit", mode: "additional", monthlyAmount: 75 },
    ],
  };
  configure(workspace);
  const original = structuredClone(workspace);
  const hooks = [], callbacks = [];
  let cursor = 0, changed = false, tree, dirty, report, localPlanning;
  let effects = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], next => {
        const value = typeof next === "function" ? next(hooks[index]) : next;
        if (!Object.is(hooks[index], value)) { hooks[index] = value; changed = true; }
      }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!hooks[index] || deps.some((value, i) => !Object.is(value, hooks[index][i]))) {
        hooks[index] = deps;
        effects.push(effect);
      }
    },
    useId() { return react.useState("planning-input-fixture")[0]; },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, crypto: globalThis.crypto,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return dashboardRequire(name);
      if (name === "@workspace/practice/hub") return hub;
      if (name === "@/components/hub/use-unsaved") return { useUnsaved(value) { dirty = value; } };
      if (name === "@/lib/profit-first-planning") return { ...planner, profitFirstPlanning(input) {
        localPlanning = structuredClone(input.workspace.moneyPlanning);
        report = planner.profitFirstPlanning(input);
        return report;
      } };
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected component import: ${name}`);
    },
  }, { filename: componentUrl.pathname });
  const props = {
    renderMode: "all",
    workspace, context: { clinicians: [], staff: [], sessions: [] }, asOf: "2026-01-15",
    estimatedMonthlyValues: { clinicianPay: 0, employerBurden: 0, staffCost: 0, fees: 0, marketing: 0 },
    onPlanningChange(next) { callbacks.push(structuredClone(next)); },
  };
  function render() {
    for (let attempts = 0; attempts < 10; attempts++) {
      cursor = 0; changed = false; effects = [];
      tree = module.exports.default(props);
      effects.forEach(effect => effect());
      if (!changed) return;
    }
    throw new Error("Hook fixture did not settle");
  }
  function input(label) {
    const matches = nodes(tree).filter(n => n.type === "input" && n.props["aria-label"] === label);
    assert.equal(matches.length, 1, `Stable explicit label: ${label}`);
    return matches[0].props;
  }
  render();
  return {
    callbacks, input,
    get planning() { return localPlanning; },
    get report() { return report; },
    get dirty() { return dirty; },
    get tree() { return tree; },
    change(label, text, badInput = false) { input(label).onChange(event(text, badInput)); render(); },
    blur(label, text, badInput = false) { input(label).onBlur(event(text, badInput)); render(); },
    enter(label, text) {
      input(label).onKeyDown({ key: "Enter", currentTarget: { blur() { input(label).onBlur(event(text)); } } });
      render();
    },
    assertError(label) {
      const control = input(label);
      assert.equal(control["aria-invalid"], true);
      const description = nodes(tree).find(n => n.props?.id === control["aria-describedby"]);
      assert.ok(description, "Error is associated with this input");
      assert.equal(description.props.role, "alert");
      assert.match(description.props.children, /finite, nonnegative/);
    },
    assertSaved() {
      assert.ok(callbacks.length > 0);
      const saved = hub.workspaceSchema.parse(JSON.parse(JSON.stringify({ ...workspace, moneyPlanning: callbacks.at(-1) })));
      props.workspace = saved;
      render();
      return saved.moneyPlanning;
    },
    assertSourceUnchanged() { assert.deepEqual(workspace, original); },
  };
}

for (const field of fields) {
  for (const raw of ["-1", "1e309", "NaN", "Infinity", ...(field.name === "floor" ? [] : [String((field.maximum ?? 1e10) + 1)])]) {
    test(`${field.name}: rejects ${raw}, retaining prior value, raw draft, and associated error`, () => {
      const f = fixture();
      f.change(field.label, raw);
      assert.equal(field.read(f.planning), field.previous);
      f.blur(field.label, raw);
      assert.equal(f.callbacks.length, 0);
      assert.equal(field.read(f.planning), field.previous);
      assert.equal(f.input(field.label).value, raw);
      f.assertError(field.label);
      assert.equal(f.dirty, true);
      f.assertSourceUnchanged();
    });
  }
  for (const blurBadInput of [true, false]) {
    test(`${field.name}: sanitized empty badInput survives blur badInput=${blurBadInput} until a valid edit`, () => {
      const f = fixture();
      f.change(field.label, "", true);
      assert.equal(field.read(f.planning), field.previous);
      f.assertError(field.label);
      f.blur(field.label, "", blurBadInput);
      assert.equal(f.callbacks.length, 0);
      assert.equal(field.read(f.planning), field.previous);
      assert.equal(f.input(field.label).value, "");
      f.assertError(field.label);
      f.change(field.label, "", false);
      f.blur(field.label, "", false);
      assert.equal(f.callbacks.length, 1);
      assert.equal(field.read(f.assertSaved()), null);
      assert.equal(f.input(field.label)["aria-invalid"], false);
      assert.equal(f.dirty, false);
    });
  }
  for (const [raw, expected] of [["", null], ["0", 0], ["240.125", 240.125], ["10000000000", 1e10]]) {
    test(`${field.name}: stages and round-trips ${JSON.stringify(raw)} as ${expected}`, () => {
      const f = fixture();
      f.change(field.label, raw);
      assert.equal(f.callbacks.length, 0, "Changes remain local until blur/Enter");
      f.enter(field.label, raw);
      assert.equal(f.callbacks.length, 1);
      assert.equal(field.read(f.assertSaved()), expected === null ? null : expected / (field.divisor ?? 1));
      assert.equal(f.input(field.label)["aria-invalid"], false);
      assert.equal(f.input(field.label)["aria-describedby"], undefined);
      assert.equal(f.dirty, false);
      f.assertSourceUnchanged();
    });
  }
  test(`${field.name}: another valid field cannot stage a valid intermediate preview hidden by invalid text`, () => {
    const f = fixture();
    f.change(field.label, "9");
    f.change(field.label, "-1");
    f.blur(field.label, "-1");
    f.change(otherLabel, "12");
    f.blur(otherLabel, "12");
    assert.equal(f.callbacks.length, 0);
    assert.equal(f.input(field.label).value, "-1");
    assert.equal(f.input(otherLabel).value, "12", "Blocked valid draft stays visible");
    f.assertError(field.label);
    f.change(field.label, "0");
    f.blur(field.label, "0");
    assert.equal(f.callbacks.length, 1);
    assert.equal(field.read(f.callbacks[0]), 0);
    assert.equal(f.callbacks[0].estimatedMonthlyValues.otherIncome, 12);
    assert.equal(f.input(field.label)["aria-invalid"], false);
  });
}

test("multiple field errors block grouped estimate, floor, and goal commits without clearing drafts or errors", () => {
  const f = fixture();
  for (const field of fields) f.change(field.label, "-1");
  for (const field of fields) {
    f.blur(field.label, "-1");
    f.assertError(field.label);
    assert.equal(field.read(f.planning), field.previous);
  }
  f.change(otherLabel, "4");
  f.blur(otherLabel, "4");
  f.change("Marketing monthly funding", "500");
  f.blur("Marketing monthly funding", "500");
  assert.equal(f.callbacks.length, 0);
  assert.equal(f.input("Marketing monthly funding").value, "500");
  for (const field of fields) {
    f.change(field.label, "0");
    f.blur(field.label, "0");
    for (const remaining of fields.slice(fields.indexOf(field) + 1)) f.assertError(remaining.label);
    assert.equal(f.callbacks.length, field === fields.at(-1) ? 1 : 0);
  }
  f.blur("Marketing monthly funding", "500");
  assert.equal(f.callbacks.length, 2);
  assert.equal(f.callbacks.at(-1).goals.find(g => g.name === "Marketing monthly funding").monthlyAmount, 500);
});

test("percentage floors above 100 and above the dollar maximum remain saveable and infeasible", () => {
  const floor = fields.find(field => field.name === "floor");
  for (const raw of ["175", "10000000001"]) {
    const f = fixture();
    f.change(floor.label, raw);
    f.blur(floor.label, raw);
    assert.equal(floor.read(f.assertSaved()), Number(raw));
    assert.equal(f.report.status, "infeasible");
    assert.equal(f.report.noFiniteRevenueSolution, true);
  }
});

test("an unset funding goal stays absent on a deliberate blank and can then be configured as zero", () => {
  const f = fixture();
  f.change("Marketing monthly funding", "-1");
  f.blur("Marketing monthly funding", "-1");
  assert.equal(f.callbacks.length, 0);
  f.change("Marketing monthly funding", "");
  f.blur("Marketing monthly funding", "");
  assert.equal(f.callbacks.length, 0);
  assert.equal(f.input("Marketing monthly funding")["aria-invalid"], false);
  assert.equal(f.dirty, false);
  f.change("Marketing monthly funding", "0");
  f.blur("Marketing monthly funding", "0");
  assert.equal(f.assertSaved().goals.find(g => g.name === "Marketing monthly funding").monthlyAmount, 0);
});

test("rendered table keeps baseline percent, current dollars and needed dollars adjacent with a signed gap", () => {
  const f = fixture();
  const headers = nodes(f.tree).filter(n => n.type === "th" && n.props.scope === "col");
  assert.deepEqual(headers.slice(0, 6).map(textContent), [
    "Bucket", "Current %", "Current allocation ($/month)", "Budget needed ($/month)", "Gap ($/month)", "Required %",
  ]);
  assert.equal(headers.length, 7);
  assert.match(textContent(headers[6]), /^Planning inputs/);
  assert.ok(nodes(headers[6]).some(node => node.type === "summary" && node.props["aria-label"].startsWith("Help:")));
  assert.deepEqual(rowCells(f, "Taxes").slice(0, 6), ["Taxes", "3%", "$300", "$1,200", "$900", "12%"]);
  assert.deepEqual(rowCells(f, "Operating expenses").slice(0, 6), ["Operating expenses", "28%", "$2,800", "$1,300", "-$1,500", "13%"]);
  const html = renderToStaticMarkup(f.tree);
  assert.match(html, /<caption>Monthly allocation planning<\/caption>/);
  assert.doesNotMatch(html, /Current estimate|Required estimate/);
  const assumptions = nodes(f.tree).find(n => n.type === "details" && textContent(n).startsWith("Planning estimate assumptions"));
  assert.equal(assumptions.props.open, undefined, "Calculation help starts collapsed");
  assert.match(textContent(assumptions), /Gap is budget needed minus current allocation/);
  assert.equal(f.callbacks.length, 0);
});

test("income preview recalculates current dollars, gaps and required percentages without staging or changing baseline", () => {
  const f = fixture();
  f.change(otherLabel, "2000");
  assert.deepEqual(rowCells(f, "Taxes").slice(0, 6), ["Taxes", "3%", "$360", "$1,200", "$840", "10%"]);
  f.change("Monthly billed revenue estimate", "18000");
  assert.deepEqual(rowCells(f, "Taxes").slice(0, 6), ["Taxes", "3%", "$600", "$1,200", "$600", "6%"]);
  assert.equal(f.callbacks.length, 0);
  f.assertSourceUnchanged();
});

test("quarterly tax editor previews /3, stages only on Enter, and round-trips the existing monthly field", () => {
  const f = fixture();
  const label = "Quarterly tax planning estimate";
  assert.equal(f.input(label).value, "3600.00");
  f.change(label, "9000");
  assert.deepEqual(rowCells(f, "Taxes").slice(0, 6), ["Taxes", "3%", "$300", "$3,000", "$2,700", "30%"]);
  assert.equal(f.callbacks.length, 0);
  f.enter(label, "9000");
  const saved = f.assertSaved();
  assert.equal(saved.estimatedMonthlyValues.taxObligations, 3000);
  assert.equal(f.input(label).value, "9000.00");
  assert.ok(!Object.hasOwn(saved.estimatedMonthlyValues, "quarterlyTax"), "Only monthly normalized data is persisted");
  f.change(label, "30000000000");
  f.enter(label, "30000000000");
  assert.equal(f.assertSaved().estimatedMonthlyValues.taxObligations, 1e10);
  f.assertSourceUnchanged();
});

test("unknown and zero income render honest current dollars and gap values", () => {
  const f = fixture();
  f.change("Monthly billed revenue estimate", "");
  assert.deepEqual(rowCells(f, "Taxes").slice(0, 6), ["Taxes", "3%", "Unknown", "$1,200", "Unknown", "Unknown"]);
  f.change("Monthly billed revenue estimate", "0");
  assert.deepEqual(rowCells(f, "Taxes").slice(0, 6), ["Taxes", "3%", "$0", "$1,200", "$1,200", "Unknown"]);
});

test("missing quarterly tax stays inline and cost sources stay collapsed until explicitly opened", () => {
  const f = fixture(workspace => { delete workspace.moneyPlanning.estimatedMonthlyValues.taxObligations; });
  const details = () => nodes(f.tree).find(n => n.type === "details" && textContent(n).startsWith("Cost estimates and source periods"));
  assert.equal(details().props.open, false);
  const taxRow = nodes(f.tree).find(node => node.type === "tr" && nodes(node).some(child => child.type === "th" && textContent(child) === "Taxes"));
  assert.ok(nodes(taxRow).some(node => node.type === "input" && node.props["aria-label"] === "Quarterly tax planning estimate"));
  assert.match(textContent(taxRow), /Quarterly tax planning estimate is missing\./);
  assert.equal(rowCells(f, "Taxes")[3], "Unknown");
  assert.equal(f.input("Quarterly tax planning estimate").value, "");
  f.change("Quarterly tax planning estimate", "0");
  assert.equal(f.report.status, "infeasible");
  assert.equal(details().props.open, false);
  details().props.onToggle({ currentTarget: { open: true } });
  f.change("Quarterly tax planning estimate", "300");
  assert.equal(details().props.open, true);
  f.change("Quarterly tax planning estimate", "0");
  details().props.onToggle({ currentTarget: { open: false } });
  f.blur("Quarterly tax planning estimate", "0");
  assert.equal(details().props.open, false);
  assert.equal(f.assertSaved().estimatedMonthlyValues.taxObligations, 0);
});
