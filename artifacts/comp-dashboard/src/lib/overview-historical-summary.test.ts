import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { historicalPerformancePeriods } from "./historical-performance-periods.ts";
import { overviewHistoricalAttrition, type OverviewHistoricalCapacityPeriod } from "./overview-historical-capacity.ts";
import { periodClientAttrition } from "./period-client-attrition.ts";
import type { ClinicianClientActivityMetric, LocalSnapshot } from "./retention-local.ts";
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
    if (url.startsWith(componentDirectory) && url.endsWith(".css")) {
      return { format: "module", shortCircuit: true, source: "export default {};" };
    }
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
  const snapshots: LocalSnapshot[] = [{
    id: "fixture", kind: "attendance", sourceHash: "fixture", importedAt: "2026-10-19T12:00:00Z",
    coverageStart: "2025-01-01", coverageEnd: "2026-10-19", coverageClinicians: ["Lane"],
    reportCoverage: { start: "2025-01-01", end: "2026-10-19", complete: true },
    rows: [{ clientId: "client", clinician: "Lane", status: "show", serviceDate: "2026-07-01", billingCode: "90837", location: null, sourceRowHash: "visit" }],
  }];
  const reports = historicalPerformancePeriods({ today: "2026-10-19", snapshots });
  for (const period of ["3mo", "year"] as const) {
    const report = reports[period];
    const recent = period === "3mo";
    // Keep this rendering fixture's immature windows explicit as calendar policy evolves.
    report.window.attrition = { ...report.window.cohort };
    report.periodAttrition = periodClientAttrition({ snapshots, requestedWindow: report.window.attrition, asOf: report.window.asOf });
    assert.ok(report.activity);
    Object.assign(report.activity, {
      initialRetentionRate: recent ? 0.8 : 0.6, retainedClientPairs: recent ? 8 : 6,
      initialRetentionDenominator: 10, immatureClientPairsExcluded: 2, initialRetentionCoverageVerified: true,
      endingFullMonthClientEnds: recent ? 9 : 6, endingFullMonthDenominator: recent ? 2 : 3,
      averageClientEndingsPerFullMonth: recent ? 4.5 : 2,
      endingAttritionPct: 99, // Latest-month control must never become period attrition.
    });
    report.clinicians = [clinician(recent ? 40 : 20, recent ? 2 : 4, 2), { ...clinician(90, 10, 2), clinician: "Moss" }];
    report.attritionActivity = structuredClone(report.activity);
    report.attritionClinicians = structuredClone(report.clinicians);
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
  return html.slice(sections[index].index, sections[index + 1]?.index ?? html.indexOf('<button type="button" class="pw-text-button"'));
};
const prominent = (html: string) => html.replace(/<details\b[\s\S]*?<\/details>/g, "");
const periodRegion = (html: string, period: "3mo" | "year") => {
  const region = html.match(new RegExp(`<section\\b[^>]*data-period="${period}"[^>]*>[\\s\\S]*?</section>`))?.[0];
  assert.ok(region, `Missing ${period} region`);
  return region;
};
const julyFixture = (returned = false, asOf = "2026-11-30"): Props => {
  const props = fixture();
  const requestedWindow = { start: "2026-07-01", end: "2026-07-31" };
  const dates = ["2026-07-02", "2026-07-09", "2026-07-16", ...(returned ? ["2026-11-01"] : [])];
  const snapshots: LocalSnapshot[] = [{
    id: "july", kind: "attendance", sourceHash: "july", importedAt: "2026-11-30T12:00:00Z",
    coverageStart: dates[0], coverageEnd: dates.at(-1)!, coverageClinicians: ["Lane"],
    reportCoverage: { start: "2026-06-01", end: "2026-11-30", complete: true },
    rows: dates.map(serviceDate => ({ clientId: "client", clinician: "Lane", serviceDate, status: "show", billingCode: "90837", location: null, sourceRowHash: serviceDate })),
  }];
  props.reports = historicalPerformancePeriods({ snapshots, today: asOf });
  // Explicit-window engine output exercises July without altering trailing-calendar anchors.
  props.reports["3mo"].window.attrition = requestedWindow;
  props.reports["3mo"].periodAttrition = periodClientAttrition({ snapshots, requestedWindow, asOf });
  return props;
};

test("all four cards show both histories simultaneously with dates in accessible disclosures and no period toggles or removed cards", () => {
  const html = render();
  const kpiLabels = [...html.matchAll(/<div class="[^"]*\bsw-content\b[^"]*"><section\b[^>]*aria-label="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(kpiLabels, labels);
  for (const label of labels) {
    const section = card(html, label);
    assert.equal([...section.matchAll(/data-period="3mo"/g)].length, 1);
    assert.equal([...section.matchAll(/data-period="year"/g)].length, 1);
    assert.match(section, label === labels[3] ? />Last 3 mature months<\/h4>/ : />Trailing 3 months<\/h4>/);
    assert.match(section, label === labels[3] ? />Last 12 mature months<\/h4>/ : />Trailing year<\/h4>/);
    assert.match(section, /dateTime="2026-07-01"/);
    assert.match(section, /dateTime="2025-10-01"/);
    assert.equal([...section.matchAll(/dateTime="2026-09-30"/g)].length, 2);
    assert.equal([...section.matchAll(/<details class="pw-historical-period-date-help"><summary>Period dates<\/summary>/g)].length, 2);
    assert.doesNotMatch(prominent(section), /dateTime=|percentage points vs 12-month baseline/);
  }
  assert.doesNotMatch(html, /<select|role="(?:tab|switch)"|type="(?:radio|checkbox)"|\shidden(?:=|\s|>)/);
  assert.match(html, /<button\b[^>]*aria-pressed="false">[\s\S]*?Edit layout<\/button>/);
  assert.match(html, /<button type="button" class="pw-text-button">Sessions<\/button>/);
  assert.doesNotMatch(html, /<h[1-6][^>]*>[^<]*(?:hiring|rooms|owner pay|profit|revenue|projection|forecast|onboarding)/i);
});

test("summary widgets default to medium, honor saved order and sizes, and keep Sessions outside the layout", () => {
  const props = fixture();
  const defaults = render(props);
  const widgets = (html: string) => [...html.matchAll(/data-widget-id="([^"]+)" data-widget-size="([^"]+)"/g)].map(([, id, size]) => ({ id, size }));
  assert.deepEqual(widgets(defaults), ["caseload", "retention", "close-rate", "attrition"].map(id => ({ id, size: "medium" })));
  assert.doesNotMatch(defaults, /pw-section-widget--card/);
  assert.match(defaults, /data-section="summary"/);
  assert.match(defaults, /<\/section><button type="button" class="pw-text-button">Sessions<\/button><\/div>$/);
  props.layout = { version: 1, widgets: [{ id: "attrition", size: "wide" }, { id: "retention", size: "small" }] };
  const before = structuredClone(props.layout);
  assert.deepEqual(widgets(render(props)), [
    { id: "attrition", size: "wide" }, { id: "retention", size: "small" },
    { id: "caseload", size: "medium" }, { id: "close-rate", size: "medium" },
  ]);
  assert.deepEqual(props.layout, before);
});

test("values use percent full and percentage-point rate differences, with separate weekly and attrition count units", () => {
  const html = render();
  const capacity = card(html, labels[0]);
  assert.match(capacity, /class="pw-percentage-kpi-value" aria-hidden="true">73\.9%<\/span>/);
  assert.match(capacity, /17 actual \/ 23 desired sessions per week/);
  assert.match(capacity, /\+5 sessions \/ week vs 12-month baseline/);
  assert.match(capacity, /\+23\.9 percentage points full vs 12-month baseline/);
  assert.match(card(html, labels[1]), /\+20 percentage points vs 12-month baseline/);
  assert.match(card(html, labels[2]), /\+50 percentage points vs 12-month baseline/);
  const attrition = card(html, labels[3]);
  assert.equal([...attrition.matchAll(/data-state="unknown"[\s\S]*?<span>-- clients ended<\/span>/g)].length, 2);
  assert.match(attrition, /The full window has not reached 90 days of follow-up\./, "September's 90-day follow-up is incomplete in October, regardless of monthly subtotal controls");
  assert.doesNotMatch(attrition, /<span>(?:9|6) clients ended<\/span>/);
  assert.match(attrition, /4\.5 \/ mature month/);
  assert.match(attrition, /2 \/ mature month/);
  assert.match(attrition, /Comparison unavailable/);
  assert.doesNotMatch(attrition, /clients \/ mature month vs 12-month baseline/);
  assert.doesNotMatch(attrition, /99%|percentage points/);
});

test("known zero rates and counts remain visible; missing evidence is unavailable rather than fabricated zero", () => {
  const props = fixture();
  const recent = props.reports["3mo"];
  assert.ok(recent.activity);
  Object.assign(recent.activity, { initialRetentionRate: 0, retainedClientPairs: 0, endingFullMonthClientEnds: 0, endingFullMonthDenominator: 1, averageClientEndingsPerFullMonth: 0 });
  const coveredZero = julyFixture(true).reports["3mo"];
  recent.window.attrition = coveredZero.window.attrition;
  recent.periodAttrition = coveredZero.periodAttrition;
  Object.assign(recent.consults.practice, { conversionRate: 0, converted: 0 });
  Object.assign(props.capacity["3mo"], { weekly: 0, utilizationPct: 0 });
  props.reports.year.activity = null;
  Object.assign(props.reports.year.consults.practice, { conversionRate: null });
  Object.assign(props.capacity.year, { weekly: null, desiredWeekly: null, utilizationPct: null, desiredBasis: "unknown" });
  const html = render(props);
  assert.match(card(html, labels[0]), /class="pw-percentage-kpi-value" aria-hidden="true">0%<\/span>/);
  assert.match(card(html, labels[0]), /data-state="unknown"[^>]*><span class="pw-percentage-kpi-value" aria-hidden="true">-<\/span>/);
  for (const label of [labels[1], labels[2]]) {
    assert.match(card(html, label), /class="pw-percentage-kpi-value" aria-hidden="true">0%<\/span>/);
    assert.match(card(html, label), /data-state="unknown"[^>]*><span class="pw-percentage-kpi-value" aria-hidden="true">-<\/span>/);
  }
  assert.match(card(html, labels[3]), /class="pw-percentage-kpi-value" aria-hidden="true">0%<\/span>[\s\S]*?<span>0 clients ended<\/span>/);
  assert.match(card(html, labels[3]), /0 ended \/ 1 unique observed established clients/);
  assert.match(card(html, labels[3]), /<span>-- clients ended<\/span>/);
  for (const label of labels) assert.match(card(html, label), /Comparison unavailable/);
});

test("selected clinician uses normalized clinician-only counts, close attribution and caller-scoped capacity", () => {
  const props = fixture();
  props.contributor = "  lAnE  ";
  for (const period of ["3mo", "year"] as const) Object.assign(props.capacity[period], { weekly: 5, desiredWeekly: 10, utilizationPct: 50 });
  const html = render(props);
  const retention = card(html, labels[1]);
  assert.match(retention, /class="pw-percentage-kpi-value" aria-hidden="true">40%<\/span>/);
  assert.match(retention, /4 retained \/ 10 evaluated starts; 3 pending/);
  assert.doesNotMatch(retention, /class="pw-percentage-kpi-value" aria-hidden="true">(?:80|90)%/);
  const consult = card(html, labels[2]);
  assert.match(consult, /class="pw-percentage-kpi-value" aria-hidden="true">20%<\/span>/);
  assert.match(consult, /5 consultations \u2192 2 confirmed closes/);
  assert.doesNotMatch(prominent(consult), /started treatment|75%|99%/);
  assert.match(card(html, labels[0]), /5 actual \/ 10 desired sessions per week/);
  assert.equal([...card(html, labels[3]).matchAll(/data-state="unknown"[\s\S]*?<span>-- clients ended<\/span>/g)].length, 2);
  assert.doesNotMatch(card(html, labels[3]), /<span>(?:2|4|9) clients ended/);
  assert.match(card(html, labels[3]), /The full window has not reached 90 days of follow-up\./, "October cannot mature the selected clinician's full September window");
  assert.match(card(html, labels[3]), /Comparison unavailable/);
  assert.doesNotMatch(card(html, labels[3]), /-1 clients \/ mature month/);
});

test("mature July evidence renders matching helper count, unique observed denominator and 100%", () => {
  const props = julyFixture();
  const result = overviewHistoricalAttrition(props.reports)["3mo"];
  assert.equal(result.total, 1);
  assert.equal(result.eligibleClients, 1);
  assert.equal(result.attritionPct, 100);
  assert.equal(result.coverageComplete, true);
  assert.equal(result.cohortQualifier, "observed-established-clients");
  const attrition = card(render(props), labels[3]);
  assert.match(attrition, /dateTime="2026-07-01"/);
  assert.match(attrition, /dateTime="2026-07-31"/);
  assert.match(prominent(attrition), /class="pw-percentage-kpi-value" aria-hidden="true">100%<\/span>[\s\S]*?<span>1 clients ended<\/span>/);
  assert.match(attrition, /1 ended \/ 1 unique observed established clients in the full labeled window/);
  assert.match(attrition, /earlier unobserved clients are not certified/);
  assert.doesNotMatch(attrition.slice(0, attrition.indexOf('data-period="year"')), /Separate mature observed portion:/, "the fully mature July result has no partial substitute; the independently immature year may have one");
  props.contributor = "  lAnE  ";
  assert.match(card(render(props), labels[3]), /class="pw-percentage-kpi-value" aria-hidden="true">100%<\/span>[\s\S]*?<span>1 clients ended<\/span>/);
});

test("mature July with a later return renders a covered zero ending and positive eligible 0%", () => {
  const props = julyFixture(true);
  const result = overviewHistoricalAttrition(props.reports)["3mo"];
  assert.equal(result.total, 0);
  assert.equal(result.eligibleClients, 1);
  assert.equal(result.attritionPct, 0);
  const attrition = card(render(props), labels[3]);
  assert.match(prominent(attrition), /class="pw-percentage-kpi-value" aria-hidden="true">0%<\/span>[\s\S]*?<span>0 clients ended<\/span>/);
  assert.match(attrition, /0 ended \/ 1 unique observed established clients/);
});

test("explicit period cohort fixtures render the selected clinician percentage rather than practice percentage", () => {
  const props = julyFixture();
  const period = props.reports["3mo"].periodAttrition;
  period.practice = { ...period.practice, totalEligible: 4, eligibleClientIds: ["client", "two", "three", "four"], percentage: 25 };
  const whole = card(render(props), labels[3]);
  assert.match(prominent(whole), /class="pw-percentage-kpi-value" aria-hidden="true">25%<\/span>[\s\S]*?<span>1 clients ended<\/span>/);
  assert.match(whole, /1 ended \/ 4 unique observed established clients/);
  props.contributor = " lAnE ";
  const selected = card(render(props), labels[3]);
  assert.match(prominent(selected), /class="pw-percentage-kpi-value" aria-hidden="true">100%<\/span>[\s\S]*?<span>1 clients ended<\/span>/);
  assert.match(selected, /1 ended \/ 1 unique observed established clients/);
  assert.doesNotMatch(prominent(selected), /25%/);
  props.contributorIdentityVerified = false;
  assert.doesNotMatch(prominent(card(render(props), labels[3])), /100%|25%|<span>1 clients ended/);
});

test("immature July renders unknown full totals and a separately dated mature observed portion", () => {
  const props = julyFixture(false, "2026-10-20");
  assert.ok(props.reports["3mo"].activity);
  Object.assign(props.reports["3mo"].activity, { endingFullMonthClientEnds: 9, endingFullMonthDenominator: 2, averageClientEndingsPerFullMonth: 4.5, endingAttritionPct: 99 });
  props.reports["3mo"].attritionActivity = structuredClone(props.reports["3mo"].activity);
  const attrition = card(render(props), labels[3]);
  assert.match(prominent(attrition), /data-state="unknown"[\s\S]*?<span>-- clients ended<\/span>/);
  assert.doesNotMatch(prominent(attrition), /<span>(?:1|9) clients ended<\/span>|100%|99%/);
  assert.match(attrition, /-- ended \/ -- unique observed established clients in the full labeled window/);
  assert.match(attrition, /The full window has not reached 90 days of follow-up\./);
  assert.match(attrition, /4\.5 \/ mature month/);
  assert.match(attrition, /Separate mature observed portion: 2026-07-01 to 2026-07-22: 1 ended \/ 1 eligible, 100%\. This is not the full trailing window\./);
  assert.doesNotMatch(prominent(attrition), /Separate mature observed portion/);
});

test("attrition differences use full-window clinician percentages while monthly averages remain separate", () => {
  const props = fixture();
  const mature = julyFixture().reports["3mo"].periodAttrition.practice;
  for (const period of ["3mo", "year"] as const) {
    const report = props.reports[period];
    const cohort = (eligible: number) => ({
      ...mature, requestedWindow: { ...report.window.attrition }, effectiveWindow: { ...report.window.attrition },
      totalEligible: eligible, totalEnded: 1, percentage: 100 / eligible,
      eligibleClientIds: Array.from({ length: eligible }, (_, index) => `client-${index}`), endingClientIds: ["client-0"],
    });
    // Explicit mature output fixtures: practice 50%/50%, Lane 20%/10%.
    report.window.asOf = "2027-02-01";
    report.periodAttrition = {
      practice: cohort(2), byClinician: [{ clinician: "Lane", ...cohort(period === "3mo" ? 5 : 10) }],
    };
  }
  const practice = card(render(props), labels[3]);
  assert.match(practice, /0 percentage points vs 12-month baseline/);
  assert.doesNotMatch(practice, /\+2\.5 clients \/ mature month/);
  props.contributor = " lAnE ";
  const selected = card(render(props), labels[3]);
  assert.match(selected, /class="pw-percentage-kpi-value" aria-hidden="true">20%<\/span>[\s\S]*?<span>1 clients ended<\/span>/);
  assert.match(selected, /class="pw-percentage-kpi-value" aria-hidden="true">10%<\/span>[\s\S]*?<span>1 clients ended<\/span>/);
  assert.match(selected, /\+10 percentage points vs 12-month baseline/);
  assert.match(selected, /1 \/ mature month/);
  assert.match(selected, /2 \/ mature month/);
  assert.doesNotMatch(selected, /clients \/ mature month vs 12-month baseline|99%|50%/);
});

test("attrition coverage reasons render as plain-language explanations", () => {
  const props = fixture();
  const reasons = ["immature-follow-up", "incomplete-window-or-follow-up-coverage", "left-censored-establishment", "incomplete-prior-establishment-coverage", "uncertain-follow-up-evidence", "zero-eligible-denominator"];
  props.reports["3mo"].periodAttrition.practice.reasons = reasons;
  const attrition = card(render(props), labels[3]);
  assert.match(attrition, /The full window has not reached 90 days of follow-up\./);
  assert.match(attrition, /Attendance coverage is incomplete for the full window and its follow-up\./);
  assert.match(attrition, /Earlier treatment history may change which clients were established\./);
  assert.match(attrition, /Earlier coverage does not establish every eligible client&#x27;s treatment history\./);
  assert.match(attrition, /Unresolved later evidence could change an ending\./);
  assert.match(attrition, /No observed established clients provide a percentage denominator\./);
  for (const reason of reasons) assert.ok(!attrition.includes(reason), `Internal reason leaked: ${reason}`);
});

test("monthly attrition uses its own activity and clinician fields without cohort fallbacks", () => {
  const props = fixture();
  for (const period of ["3mo", "year"] as const) {
    const report = props.reports[period];
    assert.ok(report.attritionActivity);
    report.attritionActivity.averageClientEndingsPerFullMonth = 7.5;
    report.attritionClinicians = [{ ...clinician(40, 13, 2), clinician: " Lane " }];
  }
  assert.match(card(render(props), labels[3]), /7\.5 \/ mature month/);
  props.contributor = " lAnE ";
  let attrition = card(render(props), labels[3]);
  assert.match(attrition, /6\.5 \/ mature month/);
  assert.doesNotMatch(attrition, /7\.5 \/ mature month|1 \/ mature month|2 \/ mature month/);
  for (const report of Object.values(props.reports)) report.attritionClinicians = [];
  assert.match(card(render(props), labels[3]), /-- \/ mature month/);
  for (const report of Object.values(props.reports)) report.attritionClinicians = [clinician(40, 13, 2), clinician(40, 13, 2)];
  assert.doesNotMatch(card(render(props), labels[3]), /6\.5 \/ mature month/);
  props.contributor = "Whole Practice";
  for (const report of Object.values(props.reports)) report.attritionActivity = null;
  attrition = card(render(props), labels[3]);
  assert.match(attrition, /-- \/ mature month/);
  assert.doesNotMatch(attrition, /4\.5 \/ mature month|2 \/ mature month/);
});

test("lagged mature attrition labels and dates remain separate from cohort dates and preserve unknown evidence", () => {
  const props = fixture();
  props.reports = historicalPerformancePeriods({ today: "2026-10-21", snapshots: [] });
  const html = render(props);
  const attrition = card(html, labels[3]);
  assert.match(attrition, />Last 3 mature months<\/h4>/);
  assert.match(attrition, />Last 12 mature months<\/h4>/);
  assert.match(attrition, /dateTime="2026-04-01"/);
  assert.match(attrition, /dateTime="2025-07-01"/);
  assert.equal([...attrition.matchAll(/dateTime="2026-06-30"/g)].length, 2);
  assert.match(attrition, /Attrition windows lag by 90 days so there is time to observe whether clients return\./);
  assert.match(attrition, /Mature dates alone do not verify coverage or earlier treatment history\./);
  assert.doesNotMatch(prominent(attrition), /lag by 90 days/);
  assert.match(attrition, /data-state="unknown"/);
  assert.doesNotMatch(attrition, /role="meter"|Report coverage verified\./);
  for (const label of [labels[1], labels[2]]) {
    const cohort = card(html, label);
    assert.match(cohort, />Trailing 3 months<\/h4>/);
    assert.match(cohort, /dateTime="2026-07-01"/);
    assert.match(cohort, /dateTime="2026-09-30"/);
    assert.doesNotMatch(cohort, /Last 3 mature months/);
  }
});

test("legacy report without periodAttrition renders unknown safely despite monthly controls", () => {
  const props = fixture();
  for (const report of Object.values(props.reports)) Reflect.deleteProperty(report, "periodAttrition");
  const attrition = card(render(props), labels[3]);
  assert.equal([...attrition.matchAll(/data-state="unknown"[\s\S]*?<span>-- clients ended<\/span>/g)].length, 2);
  assert.match(attrition, /Whole-window client evidence is unavailable\./);
  assert.doesNotMatch(attrition, /<span>(?:9|6) clients ended/);
});

test("unverified clinician identity withholds all four metrics even if populated rows and capacity were passed", () => {
  const props = fixture();
  props.contributor = "Lane";
  props.contributorIdentityVerified = false;
  const html = render(props);
  for (const label of labels) {
    const section = card(html, label);
    assert.match(section, /Comparison unavailable/);
    assert.doesNotMatch(section, /role="meter"|aria-valuenow=|<span>\d+ clients ended/);
  }
  assert.doesNotMatch(card(html, labels[0]), /17 actual|23 desired|73\.9%/);
  assert.match(card(html, labels[3]), /<span>-- clients ended<\/span>/);
});

test("funnel emphasizes consultation-to-treatment attendance; onboarding, booking, coverage and definitions stay in details", () => {
  const html = render();
  const funnel = card(html, labels[2]);
  const visible = prominent(funnel);
  assert.match(visible, /8 consultations \u2192 6 started treatment/);
  assert.match(visible, /2 pending/);
  assert.doesNotMatch(visible, /onboarding|booking|evaluated journeys|attribution rules|coverage verified/i);
  assert.match(funnel, /<details><summary>Definition<\/summary><p>8 evaluated journeys\. Started treatment means an attended qualifying treatment visit, not completed onboarding or a booking\./);
  assert.doesNotMatch(prominent(card(html, labels[1])), /28 days|PHONE|evaluated starts/);
  assert.doesNotMatch(prominent(card(html, labels[3])), /unique eligible-client|90-day follow-up/);
});

test("current, dated and unknown desired bases have distinct accurate disclosures", () => {
  let props = fixture();
  let html = card(render(props), labels[0]);
  assert.match(html, /Current desired-caseload assumption/);
  assert.doesNotMatch(prominent(html), /Current desired-caseload assumption/);
  assert.match(html, /Dated desired-caseload assumptions/);
  assert.doesNotMatch(prominent(html), /Dated desired-caseload assumptions/);
  assert.match(html, /historical staffing is unverified/);
  assert.match(html, /not verified actual historical capacity/);
  props = fixture();
  for (const period of ["3mo", "year"] as const) Object.assign(props.capacity[period], { desiredBasis: "unknown", desiredWeekly: null, utilizationPct: null, reasons: ["Desired history is unknown."] });
  html = card(render(props), labels[0]);
  assert.match(html, /Desired caseload unknown/);
  assert.doesNotMatch(prominent(html), /Desired caseload unknown/);
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

test("five desired sessions and 1.6 actual weekly render a centered 32% with a labeled target", () => {
  const props = fixture();
  for (const row of Object.values(props.capacity)) Object.assign(row, {
    weekly: 1.6, desiredWeekly: 5, utilizationPct: 32, currentDesiredWeekly: 5,
    desiredBasis: "current-card-assumptions",
  });
  const capacity = card(render(props), labels[0]);
  assert.match(capacity, /<h3>Caseload<\/h3>/);
  assert.doesNotMatch(capacity, /<h3>Desired caseload<\/h3>/);
  for (const period of ["3mo", "year"] as const) {
    const region = periodRegion(capacity, period);
    assert.match(region, /role="meter"[^>]*aria-valuenow="32"/);
    assert.match(region, /class="pw-percentage-kpi-value" aria-hidden="true">32%<\/span>/);
    assert.match(prominent(region), /Target 5 \/ week/);
    assert.match(prominent(region), /1\.6 actual \/ week/);
    assert.match(region, /pw-percentage-kpi-marker-goal" style="transform:rotate\(360deg\)"/);
    assert.match(region, /Current desired-caseload assumption/);
    assert.doesNotMatch(prominent(region), /Current desired-caseload assumption/);
  }
});

test("current 120% caseload keeps its actual central value and accessible explanation above the capped ring", () => {
  const props = fixture();
  Object.assign(props.capacity["3mo"], { weekly: 6, desiredWeekly: 5, utilizationPct: 120 });
  const recent = periodRegion(card(render(props), labels[0]), "3mo");
  assert.match(recent, /class="pw-overview-percentage-overflow"/);
  assert.match(recent, /class="pw-overview-percentage-actual" aria-hidden="true">120%<\/span>/);
  assert.match(recent, /Caseload full: 120%, above the 100% ring scale/);
  assert.match(recent, /120% full; ring capped at 100%\./);
  assert.match(recent, /Target 5 \/ week/);
  assert.match(recent, /6 actual \/ week/);
  const contextId = recent.match(/aria-describedby="[^" ]+ ([^"]+)"/)?.[1];
  assert.ok(contextId, "Actual overflow is connected to the meter's accessible context");
  assert.ok(recent.includes(`id="${contextId}" class="pw-percentage-kpi-context"`));
});

test("a year baseline above 100% is labeled accurately instead of receiving a misleading 100% marker", () => {
  const props = fixture();
  Object.assign(props.capacity.year, { weekly: 6, desiredWeekly: 5, utilizationPct: 120 });
  const capacity = card(render(props), labels[0]);
  const recent = periodRegion(capacity, "3mo");
  assert.match(recent, /Year baseline 120%; above ring scale\./);
  assert.doesNotMatch(recent, /pw-percentage-kpi-marker-practice/);
  assert.doesNotMatch(recent, /Year baseline 100%/);
  assert.match(periodRegion(capacity, "year"), /pw-overview-percentage-actual" aria-hidden="true">120%<\/span>/);
});

test("clinical goals have no invented defaults and configured zero goals retain visible and accessible text", () => {
  const props = fixture();
  for (const label of labels.slice(1)) {
    assert.doesNotMatch(card(render(props), label), /pw-percentage-kpi-marker-goal|pw-percentage-kpi-key-goal/);
  }
  props.targets = { retentionPct: 85, closeRatePct: 65, attritionPct: 0 };
  const html = render(props);
  for (const [label, goal] of [[labels[1], 85], [labels[2], 65], [labels[3], 0]] as const) {
    for (const period of ["3mo", "year"] as const) {
      const region = periodRegion(card(html, label), period);
      assert.match(region, /pw-percentage-kpi-marker-goal/);
      assert.ok(region.includes(`pw-percentage-kpi-key-goal"></i>Goal <strong>${goal}%</strong>`), "Goal is labeled without relying on color");
      assert.match(region, new RegExp(`class="pw-percentage-kpi-sr-only">[^<]*Goal ${goal}%`));
      const descriptionId = region.match(/aria-describedby="([^" ]+)/)?.[1];
      assert.ok(descriptionId);
      assert.ok(region.includes(`id="${descriptionId}" class="pw-percentage-kpi-sr-only"`));
    }
  }
  const retention = periodRegion(card(html, labels[1]), "3mo");
  assert.match(retention, /aria-valuetext="80%; Goal 85%; Year baseline 60%"/);
  assert.match(retention, /pw-percentage-kpi-key-practice"><\/i>Year baseline <strong>60%<\/strong>/);
  assert.match(periodRegion(card(html, labels[3]), "3mo"), /pw-percentage-kpi-marker-goal" style="transform:rotate\(0deg\)"/);
  props.targets = { retentionPct: null, closeRatePct: null, attritionPct: null };
  for (const label of labels.slice(1)) assert.doesNotMatch(card(render(props), label), /pw-percentage-kpi-marker-goal/);
  props.targets = { retentionPct: 85, closeRatePct: 65, attritionPct: 0 };
  props.contributor = "Lane";
  props.contributorIdentityVerified = false;
  assert.doesNotMatch(render(props), /pw-percentage-kpi-marker-goal|role="meter"/);
});

test("a cleared clinician period remains unknown without falling back to populated practice metrics", () => {
  const props = fixture();
  props.contributor = "Lane";
  const recent = props.reports["3mo"];
  recent.activity = null;
  recent.clinicians = [];
  recent.consults.byClinician = [];
  recent.periodAttrition = { ...julyFixture().reports["3mo"].periodAttrition, byClinician: [] };
  Object.assign(props.capacity["3mo"], {
    weekly: null, desiredWeekly: null, utilizationPct: null, desiredBasis: "unknown",
  });
  const html = render(props);
  for (const label of labels) {
    const region = periodRegion(card(html, label), "3mo");
    assert.match(region, /role="img"/);
    assert.match(region, /data-state="unknown"/);
    assert.doesNotMatch(region, /aria-valuenow=|role="meter"|pw-percentage-kpi-marker-goal/);
  }
  assert.doesNotMatch(periodRegion(card(html, labels[1]), "3mo"), /80%|8 retained/);
  assert.doesNotMatch(periodRegion(card(html, labels[2]), "3mo"), /75%|8 consultations|6 confirmed closes/);
  assert.doesNotMatch(periodRegion(card(html, labels[3]), "3mo"), /100%|<span>1 clients ended/);
  assert.match(periodRegion(card(html, labels[3]), "3mo"), /-- clients ended/);
  assert.match(periodRegion(card(html, labels[1]), "year"), /aria-valuenow="20"/);
  assert.match(periodRegion(card(html, labels[2]), "year"), /aria-valuenow="10"/);
});
