import { GrowthInput } from "./growth-input";
import type {
  GrowthFamily,
  GrowthSettings,
} from "../../lib/reviewed-growth-observations";
export function GrowthHiringCard({
  families,
  settings,
  onChange,
}: {
  families: GrowthFamily[];
  settings: GrowthSettings;
  onChange: (s: GrowthSettings) => void;
}) {
  return (
    <section className="pw-metric-panel" aria-label="Hiring outlook">
      <h3>Hiring</h3>
      <div className="pw-reviewed-growth-controls">
        {(["recruitmentMonths", "onboardingMonths", "rampMonths"] as const).map(
          (key, i) => (
            <label key={key}>
              {["Recruitment", "Onboarding", "Ramp"][i]} time (months)
              <GrowthInput
                type="number"
                min="0"
                max="60"
                step="any"
                placeholder="Not set"
                value={settings[key] ?? ""}
                onChange={(e) => {
                  const v =
                    e.target.value === "" ? null : Number(e.target.value);
                  if (v === null || (Number.isFinite(v) && v >= 0 && v <= 60))
                    onChange({ ...settings, [key]: v });
                }}
              />
            </label>
          ),
        )}
      </div>
      {families.length === 0 && (
        <p>Hiring timing unavailable: a valid forecast is needed.</p>
      )}
      {families.map((f) => {
        const crossing = f.projection?.physicalCrossing;
        let text = "Hiring timing unavailable: a valid forecast is needed.";
        if (f.projection && !crossing)
          text = `No capacity issue forecast within ${f.months.length} checked months.`;
        if (crossing) {
          text = `Projected capacity crossing: ${crossing}. Set recruitment, onboarding and ramp times.`;
          if (
            settings.recruitmentMonths !== null &&
            settings.onboardingMonths !== null &&
            settings.rampMonths !== null
          ) {
            const d = new Date(crossing + "-01T00:00:00Z");
            d.setUTCDate(
              d.getUTCDate() -
                Math.ceil(
                  ((settings.recruitmentMonths +
                    settings.onboardingMonths +
                    settings.rampMonths) *
                    365.2425) /
                    12,
                ),
            );
            text = `Start recruiting by ${d.toISOString().slice(0, 10)} · projected capacity crossing ${crossing}.`;
          }
        }
        return (
          <p key={f.historyMonths}>
            <strong>Last {f.historyMonths} months:</strong> {text}
          </p>
        );
      })}
      <details>
        <summary>Hiring assumptions</summary>
        <p>
          These are scope-specific projections, not a hiring commitment. Timing
          uses the selected lead scenario. Planned clinician capacity stays
          separate in Sandbox and saved Goals.
        </p>
      </details>
    </section>
  );
}
