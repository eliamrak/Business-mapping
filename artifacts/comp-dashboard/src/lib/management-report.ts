import {
  categoryReport,
  observed,
  forecastForPeriods,
  registeredMetrics,
  evaluateRules,
  type Workspace,
  type Context,
  type ForecastMonth,
} from "@workspace/practice/hub";
export type ReportSection =
  | "position"
  | "categories"
  | "forecast"
  | "decisions";
export async function managementReport(
  workspace: Workspace,
  context: Context,
  months: ForecastMonth[],
  range: { start: string; end: string },
  sections: ReportSection[],
) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape" });
  const format = (v: number | null | undefined, unit = "number") =>
    v == null
      ? "Unknown"
      : new Intl.NumberFormat("en-US", {
          maximumFractionDigits: 1,
          ...(unit === "currency"
            ? { style: "currency", currency: "USD" }
            : {}),
        }).format(v) + (unit === "percent" ? "%" : "");
  let first = true;
  const page = (title: string, basis: string) => {
    if (!first) doc.addPage();
    first = false;
    doc.setFontSize(17);
    doc.text(workspace.settings.practiceName, 14, 15);
    doc.setFontSize(12);
    doc.text(title, 14, 23);
    doc.setFontSize(9);
    doc.text(doc.splitTextToSize(basis, 265), 14, 30);
  };
  const table = (head: string[], body: (string | number)[][]) =>
    autoTable(doc, {
      startY: 43,
      head: [head],
      body,
      theme: "striped",
      styles: { fontSize: 8, cellPadding: 2.5, overflow: "linebreak" },
      headStyles: { fillColor: [38, 72, 62] },
      margin: { top: 15, bottom: 16 },
    });
  if (sections.includes("position")) {
    const actual = observed(workspace, context, range.start, range.end);
    const periods = workspace.periods.filter(
      (p) =>
        !p.archived &&
        p.status === "finalized" &&
        p.start >= range.start &&
        p.end <= range.end,
    );
    const expected = forecastForPeriods(months, periods);
    page(
      "Recorded position and forecast",
      `${range.start} to ${range.end}. Data through ${actual.dataThrough ?? "not available"}. Actual financial values use whole finalized periods; forecast amounts are prorated to those periods. Missing is not zero.`,
    );
    table(
      ["Metric", "Recorded", "Period forecast", "Difference"],
      registeredMetrics(workspace).map(([key, label, unit]) => [
        label,
        format(actual.values[key], unit),
        format(expected[key], unit),
        format(
          actual.values[key] != null && expected[key] != null
            ? actual.values[key]! - expected[key]!
            : null,
          unit,
        ),
      ]),
    );
  }
  if (sections.includes("categories")) {
    const report = categoryReport(workspace, months, range);
    page(
      "Budget and category detail",
      `${range.start} to ${range.end}. Parent subtotals include descendants; do not add parent and child rows together. Payroll and campaign forecasts are separate. ${report.fullCoverage ? "Actual coverage is complete." : "Partial finalized coverage; variances omitted."}`,
    );
    table(
      [
        "Category",
        "Direct budget",
        "Budget subtotal",
        "Forecast subtotal",
        "Recorded subtotal",
        "Budget remaining",
      ],
      report.rows.map((r) => [
        "  ".repeat(Math.min(r.depth, 8)) + r.name,
        ...[r.directBudget, r.budget, r.forecast, r.actual, r.variance].map(
          (v) => format(v, "currency"),
        ),
      ]),
    );
  }
  if (sections.includes("forecast")) {
    page(
      "Active forecast",
      `${months.length} months from ${workspace.settings.forecastStart}. Projections depend on entered data and assumptions. Cash collections, operating profit and family payments from the practice are distinct.`,
    );
    table(
      [
        "Month",
        "Sessions",
        "Earned revenue",
        "Collections",
        "Operating profit",
        "Available cash",
        "Family take-home",
        "Constraint",
      ],
      months.map((m) => [
        m.date.slice(0, 7),
        format(m.values.sessions),
        ...["revenue", "collections", "profit", "cash", "familyTakeHome"].map(
          (k) => format(m.values[k], "currency"),
        ),
        m.constraint,
      ]),
    );
  }
  if (sections.includes("decisions")) {
    page(
      "Goals and decision signals",
      "Signals are recommendations. No event is applied without review. Formula versions use the definition effective at period end.",
    );
    table(
      ["Decision", "Status", "Expected trigger", "Action date", "Response"],
      evaluateRules(workspace, months).map((s) => [
        s.rule.name,
        s.status,
        s.date ?? "Not reached",
        s.actionDate ?? "Unknown",
        [s.rule.action, ...s.rule.responses.map((r) => r.name)].join("; "),
      ]),
    );
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(
      `EMC internal business report | Generated ${new Date().toISOString().slice(0, 10)} | ${i} / ${pages}`,
      14,
      202,
    );
  }
  return doc;
}
