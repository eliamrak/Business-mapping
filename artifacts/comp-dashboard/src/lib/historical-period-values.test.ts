import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { HistoricalPeriodValuesProps } from "../components/practice/historical-period-values.tsx";

// Node's TypeScript runner strips types but needs the existing compiler for JSX.
const componentUrl = new URL("../components/practice/historical-period-values.tsx", import.meta.url);
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url !== componentUrl.href) return nextLoad(url, context);
    return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(componentUrl, "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    };
  },
});
const { HistoricalPeriodValues } = await import(componentUrl.href);
hooks.deregister();

const values: HistoricalPeriodValuesProps["values"] = {
  "3mo": {
    range: { start: "2026-07-01", end: "2026-09-30" },
    value: createElement("strong", null, "0%"),
    detail: "0 treatment starts / 1 evaluated; 1 pending; coverage unverified",
    children: createElement("span", null, "Practice comparison"),
  },
  year: {
    range: { start: "2025-10-01", end: "2026-09-30" },
    value: createElement("strong", null, "50%"),
    detail: "1 treatment start / 2 evaluated; 1 pending; coverage unverified",
    children: createElement("figure", { "aria-label": "Annual percentage circle" }, "50%"),
  },
};

test("both labeled historical regions render exact dates, values, details and ReactNode children together", () => {
  const html = renderToStaticMarkup(createElement(HistoricalPeriodValues, { values, className: "owner-layout" }));
  const sections = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)];
  assert.equal(sections.length, 2);
  const recent = sections[0][0];
  const annual = sections[1][0];
  assert.match(recent, /data-period="3mo"/);
  assert.match(recent, />Trailing 3 months<\/h4>/);
  assert.match(recent, /<time dateTime="2026-07-01">2026-07-01<\/time> to <time dateTime="2026-09-30">2026-09-30<\/time>/);
  assert.match(recent, /<strong>0%<\/strong>/);
  assert.ok(recent.includes(values["3mo"].detail as string));
  assert.match(recent, /Practice comparison/);
  assert.match(annual, /data-period="year"/);
  assert.match(annual, />Trailing year<\/h4>/);
  assert.match(annual, /<time dateTime="2025-10-01">2025-10-01<\/time> to <time dateTime="2026-09-30">2026-09-30<\/time>/);
  assert.match(annual, /<strong>50%<\/strong>/);
  assert.ok(annual.includes(values.year.detail as string));
  assert.match(annual, /<figure aria-label="Annual percentage circle">50%<\/figure>/);
  for (const section of sections) {
    const labelId = section[0].match(/aria-labelledby="([^"]+)"/)?.[1];
    assert.ok(labelId);
    assert.ok(section[0].includes(`<h4 id="${labelId}">`));
  }
  assert.match(html, /pw-historical-period-values owner-layout/);
  assert.doesNotMatch(html, /<button|<select|<details|\bhidden\b|aria-hidden/);
});

test("unknown main values and missing children stay explicit without manufactured numbers", () => {
  const unknown = { range: values["3mo"].range, value: "Unknown", detail: "No evaluated starts; coverage unverified" };
  const html = renderToStaticMarkup(createElement(HistoricalPeriodValues, { values: { "3mo": unknown, year: { ...unknown, range: values.year.range } } }));
  assert.equal([...html.matchAll(/>Unknown<\/div>/g)].length, 2);
  assert.equal([...html.matchAll(/No evaluated starts; coverage unverified/g)].length, 2);
  assert.doesNotMatch(html, /pw-historical-period-children|0%|50%/);
});

test("redundant comparison arithmetic is omitted while both labeled periods remain", () => {
  const html = renderToStaticMarkup(createElement(HistoricalPeriodValues, { values, difference: "3 months - year: -50 percentage points" }));
  assert.doesNotMatch(html, /3 months - year:|pw-historical-period-difference/);
  assert.match(html, /Trailing 3 months/);
  assert.match(html, /Trailing year/);
});
