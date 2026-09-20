import { useMemo, useState } from "react";
import { Download, Settings2 } from "lucide-react";
import { categoryReport, campaignEconomics } from "@workspace/practice/hub";
import { exportCsv } from "@/lib/hub-api";
import { fmt, type ViewProps } from "./views";

export function CategoryReport(props: ViewProps) {
  const report = useMemo(
    () => categoryReport(props.workspace, props.months, props.range),
    [props.workspace, props.months, props.range],
  );
  const [error, setError] = useState("");
  return (
    <section>
      <div className="hub-section-heading">
        <h2>Category breakdown</h2>
        <button
          className="pr-icon"
          title="Export category breakdown"
          aria-label="Export category breakdown"
          onClick={() =>
            void exportCsv(report.rows.map(({ children, ...r }) => r)).catch(
              (e) => setError(e.message),
            )
          }
        >
          <Download />
        </button>
      </div>
      <p className="hub-muted">
        {props.range.start} to {props.range.end}. Parent totals include
        descendants. Amounts are budget lines and recorded expense entries;
        payroll and campaign forecasts remain separate.
      </p>
      {!report.fullCoverage && (
        <p className="hub-muted">
          Actuals include {report.periods.length} whole finalized periods.
          Variances require full date-range coverage.
        </p>
      )}
      <div className="pr-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Direct budget</th>
              <th>Budget subtotal</th>
              <th>Forecast subtotal</th>
              <th>Recorded subtotal</th>
              <th>Budget remaining</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <span
                    style={{ paddingInlineStart: Math.min(r.depth, 8) * 12 }}
                  >
                    {r.children ? <strong>{r.name}</strong> : r.name}
                  </span>
                </td>
                <td>{fmt(r.directBudget, "currency")}</td>
                <td>{fmt(r.budget, "currency")}</td>
                <td>{fmt(r.forecast, "currency")}</td>
                <td>{fmt(r.actual, "currency")}</td>
                <td>{fmt(r.variance, "currency")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <p role="alert" className="pr-error">
          {error}
        </p>
      )}
    </section>
  );
}

export function CampaignEconomics(props: ViewProps) {
  const campaigns = props.workspace.campaigns.filter((c) => !c.archived);
  const [id, setId] = useState("");
  const campaign = campaigns.find((c) => c.id === id) ?? campaigns[0];
  const report = useMemo(
    () =>
      campaign
        ? campaignEconomics(
            campaign,
            props.workspace,
            props.context,
            props.months,
            props.range,
          )
        : null,
    [campaign, props.workspace, props.context, props.months, props.range],
  );
  if (!campaign || !report)
    return <p className="hub-muted">No campaigns recorded.</p>;
  return (
    <section>
      <div className="hub-section-heading">
        <h2>Campaign economics</h2>
        <select
          aria-label="Economics campaign"
          value={campaign.id}
          onChange={(e) => setId(e.target.value)}
        >
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          className="pr-button"
          onClick={() => props.edit("campaigns", campaign)}
        >
          <Settings2 />
          Assumptions
        </button>
      </div>
      <h3>Estimated unit economics</h3>
      <p className="hub-muted">
        Session values: {campaign.economicsSource}. Retention:{" "}
        {campaign.retentionMonths} months. Payback includes conversion and
        collection delays; unknown means unavailable or not recovered within
        retention.
      </p>
      <div className="hub-stats">
        {[
          ["Acquisition cost", report.forecast.cac, "currency"],
          [
            "Collected revenue / session",
            report.forecast.unitRevenue,
            "currency",
          ],
          ["Delivery cost / session", report.forecast.unitCost, "currency"],
          ["Revenue lifetime value", report.forecast.revenueLtv, "currency"],
          [
            "Contribution lifetime value",
            report.forecast.contributionLtv,
            "currency",
          ],
          [
            "Acquisition payback / months",
            report.forecast.paybackMonths,
            "number",
          ],
          [
            "Incremental cash required",
            report.forecast.cashRequired,
            "currency",
          ],
          [
            "Incremental forecast profit",
            report.forecast.incrementalProfit,
            "currency",
          ],
        ].map(([name, value, unit]) => (
          <div key={String(name)}>
            <span>{name}</span>
            <strong>{fmt(value as number | null, String(unit))}</strong>
          </div>
        ))}
      </div>
      <p className="hub-muted">
        Incremental results compare the shared forecast with and without this
        campaign. Shared capacity limits apply. Modeled contribution is not
        causal attribution.
      </p>
      <h3>
        Recorded results / {props.range.start} to {props.range.end}
      </h3>
      <div className="hub-stats">
        {[
          ["Advertising spend", report.actual.spend],
          ["Other tagged expenses", report.actual.expenses],
          ["Attributed collections", report.actual.revenue],
          ["Attributed delivery costs", report.actual.delivery],
          ["Recorded acquisition cost", report.actual.cac],
          ["Net attributed contribution", report.actual.netContribution],
        ].map(([name, value]) => (
          <div key={String(name)}>
            <span>{name}</span>
            <strong>{fmt(value as number | null, "currency")}</strong>
          </div>
        ))}
      </div>
      <p className="hub-muted">
        Tagged expenses must exclude advertising and delivery costs already
        entered in funnel actuals. Missing values remain unknown.
      </p>
    </section>
  );
}
