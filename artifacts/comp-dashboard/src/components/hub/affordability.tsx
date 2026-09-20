import { useState } from "react";
import { Calculator } from "lucide-react";
import { affordablePay } from "@workspace/practice/hub";
import { fmt, monthLabel, type ViewProps } from "./views";
export default function Affordability({
  workspace,
  context,
  months,
}: ViewProps) {
  const [clinician, setClinician] = useState(""),
    [mode, setMode] = useState<"salary" | "hourly" | "per_session" | "split">(
      "salary",
    ),
    [month, setMonth] = useState(0),
    [target, setTarget] = useState(workspace.settings.targetProfitMonthly),
    [result, setResult] = useState<ReturnType<typeof affordablePay> | null>(
      null,
    );
  const reset = () => setResult(null);
  return (
    <section>
      <h2>Pay affordability</h2>
      <div className="hub-form-grid">
        <label className="pr-field">
          Clinician
          <select
            value={clinician}
            onChange={(e) => {
              setClinician(e.target.value);
              reset();
            }}
          >
            <option value="">Select...</option>
            {context.clinicians
              .filter((c) =>
                workspace.settings.teamId === null
                  ? c.goalId == null
                  : c.goalId === workspace.settings.teamId,
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </select>
        </label>
        <label className="pr-field">
          Pay basis
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as typeof mode);
              reset();
            }}
          >
            <option value="salary">Annual salary</option>
            <option value="hourly">Hourly rate</option>
            <option value="per_session">Per-session pay</option>
            <option value="split">Uniform clinician split (%)</option>
          </select>
        </label>
        <label className="pr-field">
          Forecast month
          <select
            value={month}
            onChange={(e) => {
              setMonth(Number(e.target.value));
              reset();
            }}
          >
            {months.map((m, i) => (
              <option key={m.date} value={i}>
                {monthLabel(m.date)}
              </option>
            ))}
          </select>
        </label>
        <label className="pr-field">
          Minimum practice profit / month ($)
          <input
            type="number"
            min="0"
            value={target}
            onChange={(e) => {
              setTarget(Number(e.target.value));
              reset();
            }}
          />
        </label>
      </div>
      <button
        className="pr-button"
        disabled={!clinician || !Number.isFinite(target) || target < 0}
        onClick={() =>
          setResult(
            affordablePay(
              workspace,
              context,
              Number(clinician),
              mode,
              month,
              target,
            ),
          )
        }
      >
        <Calculator />
        Calculate maximum pay
      </button>
      {result &&
        (result.error ? (
          <p className="pr-error" role="status">
            {result.error}
          </p>
        ) : (
          <div className="hub-stats">
            <div>
              <span>
                Maximum modeled{" "}
                {mode === "salary"
                  ? "annual salary"
                  : mode === "split"
                    ? "uniform clinician share"
                    : mode === "hourly"
                      ? "hourly rate"
                      : "session pay"}
              </span>
              <strong>
                {result.limited ? "At least " : ""}
                {fmt(result.maximum, mode === "split" ? "percent" : "currency")}
              </strong>
            </div>
            <div>
              <span>Practice profit floor</span>
              <strong>{fmt(target, "currency")}</strong>
            </div>
          </div>
        ))}
      <p className="hub-muted">
        Selected month's volume and room limits; other clinicians stay
        unchanged. Replaces this clinician's pay terms for the estimate only.
        Salary and hourly amounts include employer burden in the profit test.
      </p>
    </section>
  );
}
