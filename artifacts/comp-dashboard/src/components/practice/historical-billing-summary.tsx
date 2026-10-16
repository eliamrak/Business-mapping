import type { historicalBillingLedger } from "@/lib/historical-billing-ledger";
const dollars = (value: number | null) => value === null ? "--" : value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function HistoricalBillingSummary({ report }: { report: ReturnType<typeof historicalBillingLedger> }) {
  return <section className="pw-money-bridge-panel" aria-label="Historical practice billed charges">
    <div className="pw-section-heading"><div><h3>Historical practice billed charges</h3><p>{report.range.start} to {report.range.end} · current and confirmed historical providers · not cash collected.</p></div></div>
    <div className="pw-money-bridge">
      <div className="pw-bridge-step pw-bridge-in"><strong>{dollars(report.reportedCharges)}</strong><span>Reconciled reported charges</span></div>
      <div className="pw-bridge-step"><strong>{report.historicalProviderCount}</strong><span>Confirmed billing-only providers · no clinician cards</span></div>
      <div className="pw-bridge-step"><strong>{report.coverageComplete ? "Verified" : "Unverified"}</strong><span>Selected report-date completeness · not operating-period or expense coverage</span></div>
    </div>
    <details open><summary>Historical monthly charges</summary>
      {report.months.map((month) => <div className="pw-overview-total" key={month.month}><span>{month.label} · {month.rowCount} accepted charge rows</span><strong>{dollars(month.charges)}</strong></div>)}
      {!report.months.length && <p className="pw-note">No reconciled monthly charge rows in the selected dates.</p>}
    </details>
    <details><summary>Billing evidence and review</summary>
      <p>{report.evidence.rawRowCount} source rows · {report.evidence.duplicateRowCount} collapsed duplicates · {report.evidence.resolvedCaseCount} approved two-charge groups · {report.unknownProviderRows} unconfirmed provider rows · {report.unconfirmedSourceRows} rows without confirmed source membership.</p>
      {report.warnings.map((warning) => <p className="pw-note" key={warning}>{warning}</p>)}
      <p className="pw-note">Historical-provider charges remain separate from current-team sessions, compensation, forecasts and operating actuals. Missing costs, payroll and collections remain unknown.</p>
    </details>
  </section>;
}
