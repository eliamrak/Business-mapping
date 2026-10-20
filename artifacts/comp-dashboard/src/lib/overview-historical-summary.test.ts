import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { historicalPerformancePeriods } from "./historical-performance-periods.ts";
import type { OverviewHistoricalCapacityPeriod } from "./overview-historical-capacity.ts";
import type { ClinicianClientActivityMetric } from "./retention-local.ts";
import type { OverviewHistoricalSummary as Summary } from "../components/practice/overview-historical-summary.tsx";

const componentUrl = new URL("../components/practice/overview-historical-summary.tsx", import.meta.url);
const componentDirectory = new URL("../components/practice/", import.meta.url).href;
// Nested component imports use Vite's extensionless resolution in production.
// Resolve those local TSX files explicitly before compiling JSX for Node.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL?.startsWith(componentDirectory) && !/\.[a-z]+$/i.test(specifier)) {
      const candidate = new URL(`${specifier}.tsx`, context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith(componentDirectory) || !url.endsWith(".tsx")) return nextLoad(url, context);
    return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    };
  },
});
let OverviewHistoricalSummary: typeof Summary;
let HistoricalDifference: typeof import("../components/practice/overview-historical-summary.tsx").HistoricalDifference;
try {
  ({ OverviewHistoricalSummary, HistoricalDifference } = await import(componentUrl.href));
} finally {
  hooks.deregister();
}
type Props = Parameters<typeof Summary>[0];
const clinician = (retention: number, endings: number, months: number): ClinicianClientActivityMetric => ({
  clinician: "Lane", coverageVerified: true, initialRetentionCoverageVerified: true,
  initialRetentionGapDays: 28, retainedClients: retention / 10, matureNonRetainedClients: 10 - retention / 10,
  pendingInitialClients: 3, initialRetentionDenominator: 10, initialRetentionPct: retention,
  endingGapDays: 90, endingObservationCutoff: "2026-07-21", endingFullMonthClientEnds: endings,
  endingFullMonthDenominator: months, averageClientEndingsPerFullMonth: endings / months,
  latestSixEndingMonths: [], latestSixClientEnds: 0, averageClientEndingsPerLatestSixMonths: null, partialEndingMonth: null,
});
function fixture(): Props {
  const reports = historicalPerformancePeriods({ today: "2026-10-19", snapshots: [{
    id: "fixture", kind: "attendance", sourceHash: "fixture", importedAt: "2026-10-19T12:00:00Z",
    coverageStart: "2025-01-01", coverageEnd: "2026-10-19", coverageClinicians: ["Lane"],
    reportCoverage: { start: "2025-01-01", end: "2026-10-19", complete: true },
    rows: [{ clientId: "client", clinician: "Lane", status: "show", serviceDate: "2026-07-01", billingCode: "90837", location: null, sourceRowHash: "visit" }],
  }] });
  for (const period of ["3mo", "year"] as const) {
    const report = reports[period];
    const recent = period === "3mo";
    assert.ok(report.activity);
    Object.assign(report.activity, {
      initialRetentionRate: recent ? 0.8 : 0.6, retainedClientPairs: recent ? 8 : 6,
      initialRetentionDenominator: 10, immatureClientPairsExcluded: 2, initialRetentionCoverageVerified: true,
      endingFullMonthClientEnds: recent ? 9 : 6, endingFullMonthDenominator: recent ? 2 : 3,
      averageClientEndingsPerFullMonth: recent ? 4.5 : 2,
      endingAttritionPct: 99, // Latest-month control must never become period attrition.
    });
    report.clinicians = [clinician(recent ? 40 : 20, recent ? 2 : 4, 2), { ...clinician(90, 10, 2), clinician: "Moss" }];
    Object.assign(report.consults.practice, {
      consultations: recent ? 8 : 12, converted: recent ? 6 : 3,
      evaluated: recent ? 8 : 12, pending: recent ? 2 : 4, conversionRate: recent ? 75 : 25,
    });
    report.consults.byClinician = [
      { ...report.consults.practice, clinician: "Lane", consultations: 5, converted: recent ? 2 : 1, evaluated: 10, pending: 3, conversionRate: recent ? 20 : 10 },
      { ...report.consults.practice, clinician: "Moss", conversionRate: 99 },
    ];
  }
  const capacityRow = (period: "3mo" | "year"): OverviewHistoricalCapacityPeriod => ({
    range: { ...reports[period].window.cohort }, weekly: period === "3mo" ? 17 : 12,
    desiredWeekly: period === "3mo" ? 23 : 24, utilizationPct: period === "3mo" ? 17 / 23 * 100 : 50,
    observedCompleted: 100, desiredBasis: period === "3mo" ? "current-card-assumptions" : "dated-profile-assumptions",
    historicalDesiredWeekly: period === "3mo" ? null : 24, currentDesiredWeekly: 23,
    coverageComplete: true, desiredCoverageComplete: period === "year", unknownDesiredDays: period === "3mo" ? 92 : 0,
    reasons: [period === "3mo" ? "Current-card desired scenario; historical staffing is unverified." : "Dated profile assumptions; not verified actual historical capacity."],
  });
  return { reports, capacity: { "3mo": capacityRow("3mo"), year: capacityRow("year") }, onSessions() {} };
}
const render = (props = fixture()) => renderToStaticMarkup(createElement(OverviewHistoricalSummary, props));
const labels = ["Overview desired session utilization", "Overview initial retention", "Overview consult conversion", "Overview average monthly attrition"];
const card = (html: string, label: string) => {
  const sections = [...html.matchAll(/<section\b[^>]*aria-label="(Overview [^"]+)"/g)];
  const index = sections.findIndex(match => match[1] === label);
  assert.ok(index >= 0, `Missing ${label}`);
  return html.slice(sections[index].index, sections[index + 1]?.index ?? html.indexOf('<button type="button"'));
};
const prominent = (html: string) => html.replace(/<details\b[\s\S]*?<\/details>/g, "");

test("all four cards show both histories simultaneously with exact dates and no period toggles or removed cards", () => {
  const html = render();
  assert.equal([...html.matchAll(/<section\b[^>]*aria-label="Overview /g)].length, 4);
  for (const label of labels) {
    const section = card(html, label);
    assert.equal([...section.matchAll(/data-period="3mo"/g)].length, 1);
    assert.equal([...section.matchAll(/data-period="year"/g)].length, 1);
    assert.match(section, />Trailing 3 months<\/h4>/);
    assert.match(section, />Trailing year<\/h4>/);
    assert.match(section, /dateTime="2026-07-01"/);
    assert.match(section, /dateTime="2025-10-01"/);
    assert.equal([...section.matchAll(/dateTime="2026-09-30"/g)].length, 2);
  }
  assert.doesNotMatch(html, /<select|role="(?:tab|switch)"|type="(?:radio|checkbox)"|\bhidden(?:=|\s|>)/);
  assert.deepEqual([...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map(match => match[1]), ["Sessions"]);
  assert.doesNotMatch(html, /<h[1-6][^>]*>[^<]*(?:hiring|rooms|owner pay|profit|revenue|projection|forecast|onboarding)/i);
});

test("values use percent full and percentage-point rate differences, with separate weekly and attrition count units", () => {
  const html = render();
  const capacity = card(html, labels[0]);
  assert.match(capacity, /<strong>73\.9% full<\/strong>/);
  assert.match(capacity, /17 actual \/ 23 desired sessions per week/);
  assert.match(capacity, /\+5 sessions \/ week vs 12-month baseline/);
  assert.match(capacity, /\+23\.9 percentage points full vs 12-month baseline/);
  assert.match(card(html, labels[1]), /\+20 percentage points vs 12-month baseline/);
  assert.match(card(html, labels[2]), /\+50 percentage points vs 12-month baseline/);
  const attrition = card(html, labels[3]);
  assert.match(attrition, /<strong>9 clients<\/strong><span>--<\/span>/);
  assert.match(attrition, /<strong>6 clients<\/strong><span>--<\/span>/);
  assert.match(attrition, /\+2\.5 clients \/ mature month vs 12-month baseline/);
  assert.doesNotMatch(attrition, /99%|percentage points/);
});

test("known zero rates and counts remain visible; missing evidence is unavailable rather than fabricated zero", () => {
  const props = fixture();
  const recent = props.reports["3mo"];
  assert.ok(recent.activity);
  Object.assign(recent.activity, { initialRetentionRate: 0, retainedClientPairs: 0, endingFullMonthClientEnds: 0, endingFullMonthDenominator: 1, averageClientEndingsPerFullMonth: 0 });
  Object.assign(recent.consults.practice, { conversionRate: 0, converted: 0 });
  Object.assign(props.capacity["3mo"], { weekly: 0, utilizationPct: 0 });
  props.reports.year.activity = null;
  Object.assign(props.reports.year.consults.practice, { conversionRate: null });
  Object.assign(props.capacity.year, { weekly: null, desiredWeekly: null, utilizationPct: null, desiredBasis: "unknown" });
  const html = render(props);
  assert.match(card(html, labels[0]), /<strong>0% full<\/strong>/);
  assert.match(card(html, labels[0]), /<strong>-- full<\/strong>/);
  for (const label of [labels[1], labels[2]]) {
    assert.match(card(html, label), /<strong>0%<\/strong>/);
    assert.match(card(html, label), /<strong>--<\/strong>/);
  }
  assert.match(card(html, labels[3]), /<strong>0 clients<\/strong>/);
  assert.match(card(html, labels[3]), /<strong>-- clients<\/strong>/);
  for (const label of labels) assert.match(card(html, label), /Comparison unavailable/);
});

test("selected clinician uses normalized clinician-only counts, close attribution and caller-scoped capacity", () => {
  const props = fixture();
  props.contributor = "  lAnE  ";
  for (const period of ["3mo", "year"] as const) Object.assign(props.capacity[period], { weekly: 5, desiredWeekly: 10, utilizationPct: 50 });
  const html = render(props);
  const retention = card(html, labels[1]);
  assert.match(retention, /<strong>40%<\/strong>/);
  assert.match(retention, /4 retained \/ 10 evaluated starts; 3 pending/);
  assert.doesNotMatch(retention, /<strong>80%|<strong>90%/);
  const consult = card(html, labels[2]);
  assert.match(consult, /<strong>20%<\/strong>/);
  assert.match(consult, /5 consultations \u2192 2 confirmed closes/);
  assert.doesNotMatch(prominent(consult), /started treatment|75%|99%/);
  assert.match(card(html, labels[0]), /5 actual \/ 10 desired sessions per week/);
  assert.match(card(html, labels[3]), /<strong>2 clients<\/strong>/);
  assert.match(card(html, labels[3]), /<strong>4 clients<\/strong>/);
  assert.doesNotMatch(card(html, labels[3]), /<strong>9 clients/);
});

test("unverified clinician identity withholds all four metrics even if populated rows and capacity were passed", () => {
  const props = fixture();
  props.contributor = "Lane";
  props.contributorIdentityVerified = false;
  const html = render(props);
  for (const label of labels) {
    const section = card(html, label);
    assert.match(section, /Comparison unavailable/);
    assert.doesNotMatch(section, /<strong>\d/);
  }
  assert.doesNotMatch(card(html, labels[0]), /17 actual|23 desired|73\.9%/);
  assert.match(card(html, labels[3]), /<strong>-- clients<\/strong>/);
});

test("funnel emphasizes consultation-to-treatment attendance; onboarding, booking, coverage and definitions stay in details", () => {
  const html = render();
  const funnel = card(html, labels[2]);
  const visible = prominent(funnel);
  assert.match(visible, /8 consultations \u2192 6 started treatment/);
  assert.match(visible, /2 pending/);
  assert.doesNotMatch(visible, /onboarding|booking|evaluated journeys|attribution rules|coverage verified/i);
  assert.match(funnel, /<details><summary>Counts and definition<\/summary><p>8 evaluated journeys\. Started treatment means an attended qualifying treatment visit, not completed onboarding or a booking\./);
  assert.doesNotMatch(prominent(card(html, labels[1])), /28 days|PHONE|evaluated starts/);
  assert.doesNotMatch(prominent(card(html, labels[3])), /unique eligible-client|90-day follow-up/);
});

test("current, dated and unknown desired bases have distinct accurate disclosures", () => {
  let props = fixture();
  let html = card(render(props), labels[0]);
  assert.match(prominent(html), /Current desired-caseload assumption/);
  assert.match(prominent(html), /Dated desired-caseload assumptions/);
  assert.match(html, /historical staffing is unverified/);
  assert.match(html, /not verified actual historical capacity/);
  props = fixture();
  for (const period of ["3mo", "year"] as const) Object.assign(props.capacity[period], { desiredBasis: "unknown", desiredWeekly: null, utilizationPct: null, reasons: ["Desired history is unknown."] });
  html = card(render(props), labels[0]);
  assert.match(prominent(html), /Desired caseload unknown/);
  assert.doesNotMatch(html, /Dated desired-caseload assumptions|Current desired-caseload assumption/);
});

test("difference control supports negative and zero percentage points without inventing unavailable deltas", () => {
  const difference = (recent: number | null, baseline: number | null) => renderToStaticMarkup(createElement(HistoricalDifference, { recent, baseline, unit: "percentage points" }));
  assert.match(difference(25, 75), />-50 percentage points vs 12-month baseline</);
  assert.match(difference(0, 0), />0 percentage points vs 12-month baseline</);
  assert.match(difference(null, 0), />Comparison unavailable</);
});

test("component rendering preserves deeply frozen reports and capacity", () => {
  const props = fixture();
  const before = structuredClone({ reports: props.reports, capacity: props.capacity });
  const freeze = (value: unknown) => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(props);
  render(props);
  assert.deepEqual({ reports: props.reports, capacity: props.capacity }, before);
});
