import type { Context, Workspace } from "@workspace/practice/hub";
import { estimatePracticeAttrition } from "@/lib/session-attrition";

type Setting = "sessionsPerClientMonth" | "retentionMonths" | "baselineRetentionPct";

function NumberSetting({
  label,
  value,
  unit,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="pw-calculation-row">
      <span>{label}</span>
      <span className="pw-calculation-entry">
        <input
          key={value}
          type="number"
          min={min}
          max={max}
          step="0.1"
          defaultValue={Math.round(value * 10) / 10}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          onBlur={(event) => {
            const next = Number(event.currentTarget.value);
            if (event.currentTarget.value.trim() === "" || !Number.isFinite(next) || next < min || next > max) {
              event.currentTarget.value = String(Math.round(value * 10) / 10);
            } else if (Math.abs(next - value) > 0.001) {
              onCommit(next);
            }
          }}
        />
        <span>{unit}</span>
      </span>
    </label>
  );
}

export default function WorkspaceCalculations({
  workspace,
  context,
  onSetting,
}: {
  workspace: Workspace;
  context: Context;
  onSetting: (key: Setting, value: number) => void;
}) {
  const { settings } = workspace;
  const attrition = 100 - settings.baselineRetentionPct;
  const lifespanRate = 100 / settings.retentionMonths;
  const observed = estimatePracticeAttrition(
    context,
    workspace,
    settings.teamId,
    new Date().toLocaleDateString("en-CA"),
  );
  const suggestedAttrition = Math.round((observed?.attritionPct ?? lifespanRate) * 10) / 10;
  const suggestionInUse = Math.abs(attrition - suggestedAttrition) < 0.05;

  return (
    <section className="pw-calculations" aria-label="Session calculations">
      <header>
        <h2>Calculations</h2>
        <p>Edit the numbers used to estimate client sessions and hiring demand.</p>
      </header>
      <div className="pw-calculation-group">
        <h3>Client activity</h3>
        <NumberSetting
          label="Average sessions per client"
          value={settings.sessionsPerClientMonth}
          unit="per month"
          min={0.1}
          max={31}
          onCommit={(value) => onSetting("sessionsPerClientMonth", value)}
        />
        <NumberSetting
          label="Average client lifespan"
          value={settings.retentionMonths}
          unit="months"
          min={1}
          max={120}
          onCommit={(value) => onSetting("retentionMonths", value)}
        />
        <p>At this pace, one new client contributes about {Math.round(settings.sessionsPerClientMonth * settings.retentionMonths * 10) / 10} sessions over their average lifespan.</p>
      </div>
      <div className="pw-calculation-group">
        <h3>Existing clients</h3>
        <NumberSetting
          label="Monthly attrition used in forecast"
          value={attrition}
          unit="%"
          min={0}
          max={100}
          onCommit={(value) => onSetting("baselineRetentionPct", 100 - value)}
        />
        <div className="pw-calculation-suggestion">
          <div>
            <span>Suggested monthly attrition</span>
            <strong>{suggestedAttrition.toFixed(1)}%</strong>
            <small>{observed
              ? `Inferred from sessions and new clients across ${observed.months} months, through ${observed.through}`
              : `Based on your ${settings.retentionMonths}-month average client lifespan`}</small>
          </div>
          <button type="button" className="pw-button" disabled={suggestionInUse}
            onClick={() => onSetting("baselineRetentionPct", 100 - suggestedAttrition)}>
            {suggestionInUse ? "In use" : "Use suggestion"}
          </button>
        </div>
        {!observed && <p>A session-based suggestion needs four consecutive months of complete team sessions and booked-client counts.</p>}
        {observed && <p>This is a session-based estimate, not a measured exit count. It assumes each newly booked client contributes {settings.sessionsPerClientMonth} sessions in the booking month.</p>}
      </div>
    </section>
  );
}
