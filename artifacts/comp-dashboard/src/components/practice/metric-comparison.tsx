import { metricComparison, type ComparisonRow } from "@/lib/metric-comparison";
import "./metric-comparison.css";

export default function MetricComparison({ rows, unit, label, percentage = false }: {
  rows: ComparisonRow[]; unit: string; label: string; percentage?: boolean;
}) {
  return <div className="pw-metric-comparison" aria-label={label}>
    {metricComparison(rows, percentage).map((row) => <div key={row.id} className="pw-metric-comparison-row" data-contributor={row.label} data-practice={row.practice || undefined}>
      <div className="pw-metric-comparison-heading"><strong>{row.label}</strong><span>{row.value === null ? "Unknown" : row.value.toLocaleString("en-US", { maximumFractionDigits: 1 })} {unit}</span></div>
      <div className="pw-metric-comparison-track" role="img" aria-label={`${row.label}: ${row.value === null ? "Unknown" : row.value} ${unit}`}>
        {row.width !== null && <i className="pw-metric-comparison-fill" style={{ width: `${row.width}%` }} />}
        {row.benchmarkPosition !== null && <i className="pw-metric-comparison-marker" title="Whole Practice benchmark" style={{ left: `${row.benchmarkPosition}%` }} />}
        {row.goalPosition !== null && <i className="pw-metric-comparison-marker pw-metric-comparison-goal" title={`Goal ${row.goal} ${unit}`} style={{ left: `${row.goalPosition}%` }} />}
        {row.capacityPosition !== null && <i className="pw-metric-comparison-marker pw-metric-comparison-capacity" title={`Capacity ${row.capacity} ${unit}`} style={{ left: `${row.capacityPosition}%` }} />}
      </div>
      {row.detail && <small>{row.detail}</small>}
    </div>)}
  </div>;
}
