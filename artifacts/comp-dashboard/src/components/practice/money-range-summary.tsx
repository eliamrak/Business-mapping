import { financialRangeBridge, type PracticeFinancialRange } from "@/lib/practice-financial-range";
const dollars = (value: number | null | undefined) => value == null ? "--" : value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function MoneyRangeSummary({ report }: { report: PracticeFinancialRange }) {
  const values = report.values;
  const bridge = financialRangeBridge(report);
  return <section className="pw-today-flow" aria-label="Selected period money flow">
    <header><h2>Money flow</h2><p>{report.range.start} to {report.range.end}</p></header>
    <p>Complete reported data covers through {report.dataThrough ?? "unverified"}. Forecast estimates begin {report.forward.range?.start ?? "unavailable or outside the selected period"}, after the covered report period, not its upload date. Incomplete periods remain forecast, not actual zeros. Reported charges are not cash collected.</p>
    {report.forward.range && <p>Future percentage compensation uses configured contractual rates. A different charged-fee compensation agreement is not inferred from billing rows.</p>}
    <div className="pw-flow-statement">
      {[["Earned session income", "revenue"], ["Clinician compensation", "clinicianPay"]].map(([label, key]) => <div className="pw-flow-row" key={key}><span>{label}</span><strong>{dollars(values[key])}</strong></div>)}
      <div className="pw-flow-row"><span>Other operating costs{report.actual.range ? " · actual ledger aggregate plus any future estimate" : " · future estimate"}</span><strong>{dollars(bridge.otherCosts)}</strong></div>
      <details><summary>Operating cost sources</summary>{bridge.components.map((row) => <div className="pw-flow-row" key={row.label}><span>{row.label}</span><strong>{dollars(row.value)}</strong></div>)}{report.actual.range && <p>Actual processing fees are not a separate recorded measure; no zero fee is assumed. The complete actual expense ledger supplies the aggregate cost above.</p>}</details>
      <div className="pw-flow-row pw-flow-profit"><span>Operating profit</span><strong>{dollars(values.profit)}</strong></div>
      {[["Collections", "collections"], ["Tax allocation", "taxReserve"], ["Reserves", "reserves"], ["Distributions", "distributions"], ["Retained cash change", "retainedCash"]].map(([label, key]) => <div className="pw-flow-row" key={key}><span>{label}</span><strong>{dollars(values[key])}</strong></div>)}
    </div>
    {report.warnings.length > 0 && <details><summary>Selected-period source and coverage limitations</summary>{report.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
    {report.sourceHistoryWarnings.length > 0 && <details><summary>Other source dates and report boundaries</summary>{report.sourceHistoryWarnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
    {report.forecastWarnings.length > 0 && <details><summary>Current forecast baseline, not selected-period actuals</summary>{report.forecastWarnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
  </section>;
}
