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
const code = ts.transpileModule(readFileSync(componentUrl, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const fields = [
  { name: "revenue", label: "Monthly billed revenue estimate", previous: 10000, read: p => p.estimatedMonthlyValues.revenue },
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

// Run the actual TSX handlers and JSX runtime with deterministic hook state.
// This intentionally provides no DOM, native input sanitization, or React scheduler.
function fixture() {
  const workspace = hub.emptyWorkspace("2026-01-01");
  workspace.moneyPlanning = {
    estimatedMonthlyValues: { revenue: 10000, overhead: 1200, otherIncome: 0 },
    scenarioPercents: { "business-profit": 150 },
    goals: [
      { id: randomUUID(), name: "Building fund monthly contribution", bucket: "business-profit", mode: "additional", monthlyAmount: 250 },
      { id: randomUUID(), name: "Custom reserve contribution", bucket: "business-profit", mode: "additional", monthlyAmount: 75 },
    ],
  };
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
  for (const raw of ["-1", "1e309", "NaN", "Infinity", ...(field.name === "floor" ? [] : ["10000000001"])]) {
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
      assert.equal(field.read(f.assertSaved()), expected);
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
  for (const raw of ["175", "10000000001"]) {
    const f = fixture();
    f.change(fields[1].label, raw);
    f.blur(fields[1].label, raw);
    assert.equal(fields[1].read(f.assertSaved()), Number(raw));
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
