import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as hub from "@workspace/practice/hub";
import * as planner from "./profit-first-planning.ts";

const require = createRequire(import.meta.url);
const component = new URL("../components/practice/profit-first-planning.tsx", import.meta.url);
const code = ts.transpileModule(readFileSync(component, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
type Node = { type: string; props: Record<string, any> };
function nodes(tree: any): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
}
function text(tree: any): string {
  if (tree?.type === "input" && tree.props["aria-label"]?.endsWith("current allocation percentage")) return String(tree.props.value);
  if (Array.isArray(tree)) return tree.map(text).join("");
  return tree == null || typeof tree === "boolean" ? "" : typeof tree === "object" ? text(tree.props?.children) : String(tree);
}

// Execute the component's handlers with deterministic hooks; browser checks cover native inputs.
function fixture(tax: number | null = 100, renderMode: "allocations" | "funding" | "all" = "allocations", estimates: Record<string, number | null> = {}) {
  const workspace = hub.emptyWorkspace("2026-10-01");
  workspace.moneyPlanning = { estimatedMonthlyValues: { revenue: 10000, otherIncome: 0, overhead: 1200, fees: 100, taxObligations: tax, ...estimates } };
  const original = structuredClone(workspace);
  const hooks: any[] = [], staged: hub.MoneyPlanningSettings[] = [];
  let cursor = 0, changed = false, tree: any, effects: (() => void)[] = [];
  const react = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (next: any) => {
        const value = typeof next === "function" ? next(hooks[index]) : next;
        if (!Object.is(value, hooks[index])) { hooks[index] = value; changed = true; }
      }];
    },
    useEffect(effect: () => void, deps: any[]) {
      const index = cursor++;
      if (!hooks[index] || deps.some((value, i) => !Object.is(value, hooks[index][i]))) {
        hooks[index] = deps; effects.push(effect);
      }
    },
    useId() { return react.useState("planning-fixture")[0]; },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(code, { module, exports: module.exports, crypto: globalThis.crypto, require(name: string) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@workspace/practice/hub") return hub;
    if (name === "@/lib/profit-first-planning") return planner;
    if (name === "@/components/hub/use-unsaved") return { useUnsaved() {} };
    if (name === "@/components/ui/popover") return { Popover: "test-popover", PopoverTrigger: "test-popover-trigger", PopoverContent: "test-popover-content" };
    if (name.endsWith(".css")) return {};
    throw new Error(`Unexpected import: ${name}`);
  } });
  const props = { workspace, context: { clinicians: [], staff: [], sessions: [] }, asOf: "2026-10-15",
    renderMode, costSource: "budget" as const,
    estimateSourcePeriod: "2026-09-24 to 2026-10-07 observed sessions",
    estimatedMonthlyValues: { clinicianPay: 0, employerBurden: 0, staffCost: 0, marketing: 0, ...estimates },
    onPlanningChange(next: hub.MoneyPlanningSettings) { staged.push(structuredClone(next)); },
  };
  function render() {
    for (let attempt = 0; attempt < 10; attempt++) {
      cursor = 0; changed = false; effects = [];
      tree = module.exports.default(props); effects.forEach(effect => effect());
      if (!changed) return;
    }
    throw new Error("Unsettled hooks");
  }
  function input(label: string) {
    const matches = nodes(tree).filter(node => node.type === "input" && node.props["aria-label"] === label);
    assert.equal(matches.length, 1, label);
    return matches[0].props;
  }
  render();
  return {
    staged, input, get tree() { return tree; },
    click(label: string) { const button = nodes(tree).find(node => node.type === "button" && text(node) === label); assert.ok(button); button.props.onClick(); render(); },
    change(label: string, value: string, badInput = false) { input(label).onChange({ target: { value, validity: { badInput } } }); render(); },
    blur(label: string, value: string) { input(label).onBlur({ target: { value, validity: { badInput: false } } }); render(); },
    enter(label: string, value: string) { input(label).onKeyDown({ key: "Enter", currentTarget: { blur() { input(label).onBlur({ target: { value } }); } } }); render(); },
    cells(label: string) {
      const row = nodes(tree).find(node => node.type === "tr" && nodes(node).some(cell => cell.type === "th" && cell.props.scope === "row" && text(cell) === label));
      assert.ok(row);
      return nodes(row).filter(node => node.type === "td").map(text);
    },
    apply() { props.workspace = hub.workspaceSchema.parse({ ...workspace, moneyPlanning: staged.at(-1) }); render(); },
    unchanged() { assert.deepEqual(workspace, original); },
  };
}

test("compact inputs preview dependent allocations, stage on blur/Enter, and retain normalized values after parent apply", () => {
  const f = fixture();
  assert.equal(nodes(f.tree).filter(node => node.type === "input" && ["Overhead set-aside estimate", "Processing cost estimate", "Existing marketing estimate"].includes(node.props["aria-label"])).length, 0);
  f.change("Business profit scenario percentage floor", "10");
  assert.equal(f.cells("Business profit")[2], "$1,000");
  f.change("Quarterly tax planning estimate", "9000");
  assert.deepEqual(f.cells("Taxes").slice(0, 5), ["3%", "$300", "$3,000", "$2,700", "30%"]);
  assert.equal(f.staged.length, 0);
  f.enter("Quarterly tax planning estimate", "9000");
  assert.equal(f.staged.length, 1);
  assert.equal(f.staged[0].estimatedMonthlyValues!.taxObligations, 3000);
  assert.equal(f.staged[0].estimatedMonthlyValues!.fees, 100, "Old cost values are retained, not edited in Money");
  f.apply();
  assert.equal(f.input("Quarterly tax planning estimate").value, "9000.00");
  f.unchanged();
});

test("invalid allocation choices and native badInput block grouped staging until corrected", () => {
  const f = fixture();
  f.change("Business profit scenario percentage floor", "", true);
  f.blur("Business profit scenario percentage floor", "");
  assert.equal(f.input("Business profit scenario percentage floor")["aria-invalid"], true);
  f.change("Quarterly tax planning estimate", "2400");
  f.blur("Quarterly tax planning estimate", "2400");
  assert.equal(f.staged.length, 0);
  f.change("Business profit scenario percentage floor", "0");
  f.blur("Business profit scenario percentage floor", "0");
  assert.equal(f.staged[0].scenarioPercents!["business-profit"], 0);
  assert.equal(f.staged[0].estimatedMonthlyValues!.taxObligations, 800);
  f.unchanged();
});

test("missing taxes show the exact missing input, sources stay collapsed, and the heading names October", () => {
  const f = fixture(null);
  assert.equal(text(nodes(f.tree).find(node => node.type === "h2")), "October 2026 allocations");
  assert.equal(f.cells("Taxes")[2], "Unknown");
  assert.match(f.cells("Taxes").at(-1)!, /Quarterly tax planning estimate is missing\./);
  const details = nodes(f.tree).find(node => node.type === "details" && text(node).startsWith("Cost estimates and source periods"));
  assert.equal(details?.props.open, false);
  assert.match(text(details), /2026-09-24 to 2026-10-07/);
  assert.doesNotMatch(text(f.tree), /Erin|Elia|recorded achievement/);
  const funding = nodes(f.tree).find(node => node.type === "details" && text(node).startsWith("Monthly funding goals"));
  assert.equal(funding, undefined, "Funding editors belong in Goals by default");
  const help = nodes(f.tree).filter(node => node.type === "button" && node.props.className === "pf-help");
  assert.ok(help.length > 0);
  assert.ok(help.every(node => node.props["aria-label"].startsWith("Help: ") && node.props.type === "button"));
  assert.match(text(f.tree), /Minimum income share %/);
  f.change("Quarterly tax planning estimate", "0");
  assert.equal(f.cells("Taxes")[2], "$0");
  assert.equal(details?.props.open, false);
  assert.equal(f.staged.length, 0);
});

test("funding-only mode exposes contribution editors without Money allocations and preserves persistence", () => {
  const f = fixture(100, "funding");
  assert.equal(nodes(f.tree).some(node => node.type === "table"), false);
  f.change("Building fund monthly contribution", "250");
  assert.equal(f.staged.length, 0);
  f.enter("Building fund monthly contribution", "250");
  assert.equal(f.staged[0].goals![0].monthlyAmount, 250);
  assert.equal(f.staged[0].estimatedMonthlyValues!.overhead, 1200);
  f.apply();
  assert.equal(f.input("Building fund monthly contribution").value, 250);
  f.unchanged();
});

test("responsive allocation cells carry labels and explicit table roles", () => {
  const f = fixture();
  const table = nodes(f.tree).find(node => node.type === "table");
  assert.equal(table?.props.role, "table");
  const rows = nodes(f.tree).filter(node => node.type === "tr");
  assert.ok(rows.every(row => row.props.role === "row"));
  assert.ok(nodes(f.tree).filter(node => node.type === "th").every(node => node.props.role === (node.props.scope === "row" ? "rowheader" : "columnheader")));
  for (const cell of nodes(f.tree).filter(node => node.type === "td")) {
    assert.equal(cell.props.role, "cell");
    assert.ok(cell.props["data-label"]);
  }
});

test("current percentages recalculate current dollars independently of a higher profit goal and persist without normalization", () => {
  const f = fixture();
  f.change("Business profit scenario percentage floor", "50");
  const label = "Business profit current allocation percentage";
  f.change(label, "8");
  assert.deepEqual(f.cells("Business profit").slice(0, 4), ["8%", "$800", "$5,000", "$4,200"]);
  assert.match(text(f.tree), /Current allocations total 106%/);
  assert.equal(f.staged.length, 0);
  f.enter(label, "8");
  assert.equal(f.staged[0].currentPercents!["business-profit"], 8);
  f.apply();
  assert.equal(f.input(label).value, 8);
  f.unchanged();
});

test("current percentage rejects blanks, out-of-range and native badInput; explicit zero remains saveable", () => {
  for (const [raw, badInput] of [["", false], ["-1", false], ["101", false], ["NaN", false], ["1e309", false], ["", true]] as const) {
    const f = fixture();
    const label = "Business profit current allocation percentage";
    f.change(label, raw, badInput);
    f.blur(label, raw);
    assert.equal(f.input(label)["aria-invalid"], true);
    assert.equal(f.cells("Business profit")[1], "$200", "Invalid text retains the last valid allocation");
    f.change("Quarterly tax planning estimate", "600");
    f.blur("Quarterly tax planning estimate", "600");
    assert.equal(f.staged.length, 0);
    f.change(label, "0");
    f.enter(label, "0");
    f.apply();
    assert.equal(f.input(label).value, 0);
    assert.equal(f.cells("Business profit")[1], "$0");
    assert.equal(f.staged[0].currentPercents!["business-profit"], 0);
    f.unchanged();
  }
});

test("payroll disclosure separates pay from employer costs without changing allocation inputs", () => {
  const f = fixture(100, "allocations", {revenue:100000,clinicianPay:45000,coOwnerSalaryPretax:8000,employerBurden:4500,ownerClinicianEmployerBurden:0,nonClinicalClinicianEmployerBurden:0});
  const detail = nodes(f.tree).find(node => node.type === "details" && node.props.className === "pf-payroll-breakdown");
  assert.ok(detail);
  assert.match(text(detail), /Pay only, excluding owner pay\$37,000.00 · 37% of modeled income/);
  assert.match(text(detail), /Clinical employer costs\$4,500.00 · 4.5% of modeled income/);
  assert.match(text(detail), /Combined before floors and goals\$41,500.00 · 41.5% of modeled income/);
  assert.match(text(detail), /Processing fees are separate Operating expenses/);
});
test("unknown payroll stays unknown in its pay-versus-cost disclosure", () => {
  const f = fixture(100, "allocations", {clinicianPay:null,employerBurden:0});
  const detail = nodes(f.tree).find(node => node.type === "details" && node.props.className === "pf-payroll-breakdown");
  assert.match(text(detail), /Pay only, excluding owner payUnknown/);
  assert.match(text(detail), /Combined before floors and goalsUnknown/);
});

test("calculated-payroll reset stages only payroll override removal and restores matching role basis", () => {
 const f=fixture(100,"allocations",{revenue:100000,clinicianPay:45000,employerBurden:4500,ownerClinicianEmployerBurden:0,nonClinicalClinicianEmployerBurden:0});
 f.change("Total clinician employer cost estimate","6000");f.blur("Total clinician employer cost estimate","6000");
 assert.match(f.cells("Therapist payroll").join(" "),/Unknown/);
 f.click("Use calculated clinician payroll");
 assert.equal(f.staged.at(-1)!.estimatedMonthlyValues!.employerBurden,undefined);
 assert.equal(f.staged.at(-1)!.estimatedMonthlyValues!.clinicianPay,undefined);
 assert.equal(f.staged.at(-1)!.estimatedMonthlyValues!.revenue,100000);
 assert.equal(f.staged.at(-1)!.estimatedMonthlyValues!.taxObligations,100);
 assert.doesNotMatch(f.cells("Therapist payroll").join(" "),/Unknown/);
 f.unchanged();
});
