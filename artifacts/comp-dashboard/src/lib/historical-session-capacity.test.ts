import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { historicalPerformancePeriods } from "./historical-performance-periods.ts";
import type { HistoricalSessionCapacityProps } from "../components/practice/historical-session-capacity.tsx";

const componentUrl = new URL("../components/practice/historical-session-capacity.tsx", import.meta.url);
const valuesUrl = new URL("../components/practice/historical-period-values.tsx", import.meta.url);
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url !== componentUrl.href && url !== valuesUrl.href) return nextLoad(url, context);
    return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    };
  },
});
let HistoricalSessionCapacity: typeof import("../components/practice/historical-session-capacity.tsx").HistoricalSessionCapacity;
try {
  ({ HistoricalSessionCapacity } = await import(componentUrl.href));
} finally {
  hooks.deregister();
}

const fixture = (): HistoricalSessionCapacityProps => {
  const reports = historicalPerformancePeriods({ snapshots: [], today: "2026-10-20" });
  const row = (period: "3mo" | "year") => ({
    range: reports[period].window.cohort, weekly: period === "3mo" ? 17 : 10,
    desiredWeekly: period === "3mo" ? 23 : 20, utilizationPct: period === "3mo" ? 17 / 23 * 100 : 50,
    observedCompleted: 100, desiredBasis: "current-card-assumptions" as const,
    historicalDesiredWeekly: null, currentDesiredWeekly: period === "3mo" ? 23 : 20,
    coverageComplete: true, desiredCoverageComplete: false, unknownDesiredDays: 92,
    reasons: ["Historical desired capacity is unverified."],
  });
  return { reports, capacity: { "3mo": row("3mo"), year: row("year") } };
};

test("Team session histories render actual/desired weekly pace, percent full, dates without redundant arithmetic", () => {
  const props = fixture();
  const before = structuredClone(props);
  const html = renderToStaticMarkup(createElement(HistoricalSessionCapacity, props));
  for (const text of ["Trailing 3 months", "Trailing year", "2026-07-01", "2025-10-01", "2026-09-30",
    "17 actual / week", "23 desired / week", "73.9% full", "10 actual / week", "20 desired / week", "50% full"]) assert.ok(html.includes(text), text);
  assert.equal([...html.matchAll(/<details>/g)].length, 2);
  assert.doesNotMatch(html, /<details\s+open|<button|<select/);
  assert.match(html, /Coverage and assumptions/);
  assert.match(html, /Current clinician-card desired-session assumptions/);
  assert.deepEqual(props, before);
});

test("missing capacity keeps both dates and every value unknown", () => {
  const props = fixture();
  const html = renderToStaticMarkup(createElement(HistoricalSessionCapacity, { reports: props.reports, capacity: undefined }));
  assert.match(html, /2026-07-01/);
  assert.match(html, /2025-10-01/);
  assert.equal([...html.matchAll(/Unknown actual \/ week/g)].length, 2);
  assert.equal([...html.matchAll(/Unknown desired \/ week/g)].length, 2);
  assert.equal([...html.matchAll(/Unknown full/g)].length, 2);
  assert.doesNotMatch(html, /3 months - year:/);
  assert.doesNotMatch(html, /0 actual|0 desired|0% full/);
});

test("clipped session history displays effective dates and discloses the requested calendar without a tenure claim", () => {
  const props = fixture();
  const year = props.capacity!.year;
  year.requestedRange = { ...year.range };
  year.effectiveRange = { start: "2026-06-01", end: "2026-09-29" };
  year.range = { ...year.effectiveRange };
  const html = renderToStaticMarkup(createElement(HistoricalSessionCapacity, props));
  assert.match(html, /Available history: 2026-06-01 to 2026-09-29/);
  assert.match(html, /Requested: 2025-10-01 to 2026-09-30/);
  assert.match(html, /Employment tenure is unverified/);
});

test("capacity percentages above 100 stay visible while a missing weekly observation never becomes zero", () => {
  const props = fixture();
  props.capacity!["3mo"].utilizationPct = 150;
  props.capacity!.year.weekly = null;
  const html = renderToStaticMarkup(createElement(HistoricalSessionCapacity, props));
  assert.match(html, /150% full/);
  assert.match(html, /Unknown actual \/ week/);
  assert.doesNotMatch(html, /3 months - year:/);
});
