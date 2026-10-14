import { useId, type CSSProperties, type ReactNode } from "react";
import { buildPercentageKpi, type PercentageKpiInput } from "../../lib/percentage-kpi.ts";
import "./percentage-kpi.css";

export type PercentageKpiProps = PercentageKpiInput & {
  label: string;
  benchmarkLabel?: string;
  observed?: ReactNode;
  provenance?: ReactNode;
  pending?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export default function PercentageKpi({
  label, benchmarkLabel = "Practice average", observed, provenance, pending, children,
  className = "", ...input
}: PercentageKpiProps) {
  const id = useId();
  const model = buildPercentageKpi(input);
  const hasContext = observed != null || provenance != null || pending != null || input.period != null;
  const markers = [
    { key: "capacity", label: "Capacity", value: model.capacity, text: model.capacityText, angle: model.capacityAngle },
    { key: "goal", label: "Goal", value: model.goal, text: model.goalText, angle: model.goalAngle },
    { key: "practice", label: benchmarkLabel, value: model.benchmark, text: model.benchmarkText, angle: model.benchmarkAngle },
  ].filter((marker) => marker.value !== null);
  const description = [model.value === null ? "Unknown" : model.valueText,
    ...markers.map((marker) => `${marker.label} ${marker.text}`)].join("; ");

  return <figure className={`pw-percentage-kpi ${className}`}>
    <figcaption id={`${id}-label`} className="pw-percentage-kpi-label">{label}</figcaption>
    <div className="pw-percentage-kpi-ring"
      role={model.value === null ? "img" : "meter"}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-description${hasContext ? ` ${id}-context` : ""}`}
      aria-valuemin={model.value === null ? undefined : 0}
      aria-valuemax={model.value === null ? undefined : 100}
      aria-valuenow={model.value ?? undefined}
      aria-valuetext={model.value === null ? undefined : description}
      data-state={model.value === null ? "unknown" : "observed"}
      style={{ "--pw-percentage-angle": `${model.valueAngle ?? 0}deg` } as CSSProperties}>
      <span className="pw-percentage-kpi-value" aria-hidden="true">{model.valueText}</span>
      {markers.map((marker) => <span key={marker.key} aria-hidden="true"
        className={`pw-percentage-kpi-marker pw-percentage-kpi-marker-${marker.key}`}
        style={{ transform: `rotate(${marker.angle}deg)` }} />)}
    </div>
    <span id={`${id}-description`} className="pw-percentage-kpi-sr-only">{description}</span>
    {!!markers.length && <div className="pw-percentage-kpi-legend" aria-hidden="true">
      {markers.map((marker) => <span key={marker.key}>
        <i className={`pw-percentage-kpi-key pw-percentage-kpi-key-${marker.key}`} />
        {marker.label} <strong>{marker.text}</strong>
      </span>)}
    </div>}
    {hasContext && <div id={`${id}-context`} className="pw-percentage-kpi-context">
      {input.period && <span>{input.period.start} - {input.period.end}</span>}
      {observed != null && <span>{observed}</span>}
      {provenance != null && <span>{provenance}</span>}
      {pending != null && <span>{pending}</span>}
    </div>}
    {children != null && <div className="pw-percentage-kpi-details">{children}</div>}
  </figure>;
}

export { PercentageKpi };
