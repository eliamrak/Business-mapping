import { useEffect, useId, useState } from "react";
import { DollarSign, Percent } from "lucide-react";
import {
  overheadGoalPatch,
  overheadGoalSummary,
  type OverheadGoalBasis,
  type OverheadGoalPatch,
  type OverheadGoalSettings,
} from "@/lib/overhead-goal";

const money = (value: number | null) =>
  value === null
    ? "Unavailable"
    : value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const targetLabel = (settings: OverheadGoalSettings) =>
  settings.overheadGoalBasis === "fixed_percent"
    ? `${settings.overheadGoalPercent ?? "--"}% of revenue`
    : settings.overheadGoalBasis === "fixed_dollars"
      ? `${money(settings.overheadFloorMonthly)} monthly`
      : "Legacy expense settings";

export type OverheadGoalEditorProps = {
  savedSettings: OverheadGoalSettings;
  stagedSettings?: OverheadGoalSettings;
  matchingPeriodRevenue: number | null;
  periodLabel?: string;
  monthFraction?: number;
  disabled?: boolean;
  onChange: (patch: OverheadGoalPatch) => void;
};

export default function OverheadGoalEditor({
  savedSettings,
  stagedSettings,
  matchingPeriodRevenue,
  periodLabel = "Selected month",
  monthFraction = 1,
  disabled = false,
  onChange,
}: OverheadGoalEditorProps) {
  const settings = stagedSettings ?? savedSettings;
  const initialBasis =
    settings.overheadGoalBasis ??
    (settings.overheadMode === "baseline" ? "fixed_dollars" : undefined);
  const [basis, setBasis] = useState<OverheadGoalBasis | undefined>(
    initialBasis,
  );
  const [value, setValue] = useState(
    String(
      initialBasis === "fixed_percent"
        ? (settings.overheadGoalPercent ?? "")
        : settings.overheadFloorMonthly,
    ),
  );
  const [error, setError] = useState("");
  const id = useId();
  useEffect(() => {
    const nextBasis =
      settings.overheadGoalBasis ??
      (settings.overheadMode === "baseline" ? "fixed_dollars" : undefined);
    setBasis(nextBasis);
    setValue(
      String(
        nextBasis === "fixed_percent"
          ? (settings.overheadGoalPercent ?? "")
          : settings.overheadFloorMonthly,
      ),
    );
    setError("");
  }, [
    settings.overheadGoalBasis,
    settings.overheadGoalPercent,
    settings.overheadFloorMonthly,
    settings.overheadMode,
  ]);

  function stage(nextBasis: OverheadGoalBasis, text: string) {
    setBasis(nextBasis);
    setValue(text);
    if (!text.trim()) {
      setError("Enter an overhead target.");
      return;
    }
    try {
      onChange(overheadGoalPatch(nextBasis, Number(text)));
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Enter a valid overhead target.",
      );
    }
  }

  function choose(nextBasis: OverheadGoalBasis) {
    const equivalent = overheadGoalSummary(
      settings,
      matchingPeriodRevenue,
      monthFraction,
    );
    const percent = settings.overheadGoalPercent ?? equivalent.percent;
    stage(
      nextBasis,
      nextBasis === "fixed_dollars"
        ? String(settings.overheadFloorMonthly)
        : percent !== null && percent !== undefined && percent <= 100
          ? String(percent)
          : "",
    );
  }

  const draft =
    basis &&
    value.trim() &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0 &&
    Number(value) <= (basis === "fixed_percent" ? 100 : 1e10)
      ? { ...settings, ...overheadGoalPatch(basis, Number(value)) }
      : settings;
  const equivalent = overheadGoalSummary(
    draft,
    matchingPeriodRevenue,
    monthFraction,
  );
  return (
    <div className="pw-edit-grid">
      <fieldset className="pw-draft-field" disabled={disabled}>
        <legend>Overhead goal basis</legend>
        <label>
          <input
            type="radio"
            name={`${id}-basis`}
            checked={basis === "fixed_dollars"}
            onChange={() => choose("fixed_dollars")}
          />
          <DollarSign size={14} aria-hidden="true" /> Fixed dollars
        </label>
        <label>
          <input
            type="radio"
            name={`${id}-basis`}
            checked={basis === "fixed_percent"}
            onChange={() => choose("fixed_percent")}
          />
          <Percent size={14} aria-hidden="true" /> Fixed percentage
        </label>
      </fieldset>
      <label className="pw-draft-field" htmlFor={`${id}-amount`}>
        <span>
          {basis === "fixed_percent"
            ? "Percentage of revenue"
            : "Monthly dollars"}
        </span>
        <input
          id={`${id}-amount`}
          type="number"
          min={0}
          max={basis === "fixed_percent" ? 100 : 1e10}
          step="any"
          value={basis ? value : ""}
          disabled={disabled || !basis}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            if (basis) stage(basis, event.target.value);
          }}
        />
      </label>
      <div className="pw-readout">
        <span>Calculated equivalent · {periodLabel}</span>
        <strong>
          {basis === "fixed_percent"
            ? money(equivalent.dollars)
            : equivalent.percent === null
              ? "Waiting for revenue"
              : `${equivalent.percent.toFixed(1)}% of revenue`}
        </strong>
      </div>
      <div className="pw-readout">
        <span>Saved target</span>
        <strong>{targetLabel(savedSettings)}</strong>
      </div>
      {stagedSettings && (
        <div className="pw-readout">
          <span>Staged target</span>
          <strong>{targetLabel(stagedSettings)}</strong>
        </div>
      )}
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
