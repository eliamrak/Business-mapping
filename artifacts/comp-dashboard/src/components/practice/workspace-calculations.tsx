import type { Context, Workspace } from "@workspace/practice/hub";
import { estimatePracticeAttrition } from "@/lib/session-attrition";
import type { LocalClientActivityEstimate } from "@/lib/retention-local";

type Setting =
  | "sessionsPerClientMonth"
  | "retentionMonths"
  | "baselineRetentionPct";

const rounded = (value: number, places = 1) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const sameEstimate = (current: number, estimate: number) =>
  Math.abs(current - estimate) < 0.05;

function NumberSetting({
  label,
  value,
  unit,
  min,
  max,
  onCommit,
  estimate,
  estimateLabel,
  onUseEstimate,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  estimate?: number | null;
  estimateLabel?: string;
  onUseEstimate?: () => void;
}) {
  const estimateInUse =
    estimate !== null &&
    estimate !== undefined &&
    sameEstimate(value, estimate);
  return (
    <div className="pw-calculation-row">
      <label>
        <span>{label}</span>
        <span className="pw-calculation-entry">
          <input
            key={value}
            type="number"
            min={min}
            max={max}
            step="0.1"
            defaultValue={rounded(value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            onBlur={(event) => {
              const next = Number(event.currentTarget.value);
              if (
                event.currentTarget.value.trim() === "" ||
                !Number.isFinite(next) ||
                next < min ||
                next > max
              ) {
                event.currentTarget.value = String(rounded(value));
              } else if (Math.abs(next - value) > 0.001) {
                onCommit(next);
              }
            }}
          />
          <span>{unit}</span>
        </span>
      </label>
      {estimate !== null && estimate !== undefined && onUseEstimate && (
        <div className="pw-calculation-estimate">
          <span>{estimateLabel ?? "Estimate"}</span>
          <strong>
            {rounded(estimate).toFixed(1)} {unit}
          </strong>
          <button
            type="button"
            className="pw-button"
            disabled={estimateInUse}
            onClick={onUseEstimate}
          >
            {estimateInUse ? "Using estimate" : "Use estimate"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function WorkspaceCalculations({
  workspace,
  context,
  onSetting,
  clientActivityEstimate,
}: {
  workspace: Workspace;
  context: Context;
  onSetting: (key: Setting, value: number) => void;
  clientActivityEstimate?: LocalClientActivityEstimate | null;
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
  const activitySuggestedAttrition =
    clientActivityEstimate?.monthlyAttritionPct;
  const suggestedAttrition = rounded(
    activitySuggestedAttrition ?? observed?.attritionPct ?? lifespanRate,
  );
  const suggestionInUse = sameEstimate(attrition, suggestedAttrition);
  const suggestedSessionsPerMonth =
    clientActivityEstimate?.observedAttendedSessionsPerMonth;
  const suggestedRetentionMonths = undefined;
  const suggestedSessionCount =
    clientActivityEstimate?.observedAttendedSessionsPerRetainedClient;
  const averageClientLosses =
    clientActivityEstimate?.estimatedClientsLeavingPerMonth;
  const hasObservedInactivityEstimate =
    clientActivityEstimate?.monthlyAttritionPct !== null &&
    clientActivityEstimate?.monthlyAttritionPct !== undefined;
  const eligibleInactivityMonthCount =
    clientActivityEstimate?.eligibleInactivityMonths.length ?? 0;
  const eligibleInactivityRange =
    clientActivityEstimate && eligibleInactivityMonthCount > 0
      ? `${clientActivityEstimate.eligibleInactivityMonths[0]} to ${clientActivityEstimate.eligibleInactivityMonths.at(-1)}`
      : null;

  return (
    <section className="pw-calculations" aria-label="Session calculations">
      <header>
        <h2>Calculations</h2>
        <p>
          Edit the manual forecast inputs used to estimate client sessions and
          hiring demand. Import-derived estimates refresh when new packages are
          saved, but these fields stay manual until you choose Use estimate.
        </p>
      </header>
      {clientActivityEstimate && (
        <div className="pw-client-activity-estimate">
          <div>
            <span>Client-clinician returns</span>
            <strong>
              {clientActivityEstimate.retainedClientPairs.toLocaleString()}
            </strong>
            <small>
              A client counts for a clinician after a later-date derived
              attended visit with that same clinician; one client can count for
              more than one clinician, and this does not mean they are currently
              active.
            </small>
          </div>
          <div>
            <span>Observed visits per returning client-clinician</span>
            <strong>{rounded(suggestedSessionCount ?? 0).toFixed(1)}</strong>
            <small>Observed-to-date count, not a lifetime total.</small>
          </div>
          <div>
            <span>Average client losses / month</span>
            <strong>
              {averageClientLosses === null || averageClientLosses === undefined
                ? "--"
                : rounded(averageClientLosses).toFixed(1)}
            </strong>
            <small>
              {eligibleInactivityRange && averageClientLosses !== null
                ? `Estimated from ${clientActivityEstimate.inactiveClientTransitions.toLocaleString()} six-week inactivity transition${clientActivityEstimate.inactiveClientTransitions === 1 ? "" : "s"} across ${eligibleInactivityMonthCount.toLocaleString()} eligible fully covered month${eligibleInactivityMonthCount === 1 ? "" : "s"}, ${eligibleInactivityRange}.`
                : "Needs eligible fully covered history before estimating monthly losses."}
            </small>
          </div>
        </div>
      )}
      <div className="pw-calculation-group">
        <h3>Client activity</h3>
        <NumberSetting
          label="Average attended visits per client"
          value={settings.sessionsPerClientMonth}
          unit="per month"
          min={0.1}
          max={31}
          onCommit={(value) => onSetting("sessionsPerClientMonth", value)}
          estimate={suggestedSessionsPerMonth}
          estimateLabel="Returning client-clinician attendance frequency"
          onUseEstimate={
            suggestedSessionsPerMonth === undefined
              ? undefined
              : () =>
                  onSetting(
                    "sessionsPerClientMonth",
                    rounded(suggestedSessionsPerMonth),
                  )
          }
        />
        <NumberSetting
          label="Average client lifespan"
          value={settings.retentionMonths}
          unit="months"
          min={1}
          max={120}
          onCommit={(value) => onSetting("retentionMonths", value)}
          estimate={suggestedRetentionMonths}
          estimateLabel="Observed session count / monthly frequency"
          onUseEstimate={
            suggestedRetentionMonths === undefined
              ? undefined
              : () =>
                  onSetting(
                    "retentionMonths",
                    rounded(suggestedRetentionMonths),
                  )
          }
        />
        <p>
          At this pace, one new client contributes about{" "}
          {rounded(settings.sessionsPerClientMonth * settings.retentionMonths)}{" "}
          attended visits over the forecast lifespan.
        </p>
        {clientActivityEstimate ? (
          <p>
            Visit-frequency estimate: clients who returned to the same clinician
            only; observed visit count is the average derived attended visits
            already imported for those client-clinician histories. Monthly
            frequency is derived attended visits divided by each history's
            observed month-equivalent span from first visit to last visit.
          </p>
        ) : (
          <p>
            Import attendance history with clients who returned to the same
            clinician to calculate return-based estimates.
          </p>
        )}
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
            <span>
              {hasObservedInactivityEstimate
                ? "Observed monthly inactivity rate"
                : "Suggested monthly attrition"}
            </span>
            <strong>{suggestedAttrition.toFixed(1)}%</strong>
            <small>
              {clientActivityEstimate && hasObservedInactivityEstimate
                ? `${clientActivityEstimate.inactiveClientTransitions.toLocaleString()} client inactivity transition${clientActivityEstimate.inactiveClientTransitions === 1 ? "" : "s"} / ${clientActivityEstimate.activeClientMonthDenominator.toLocaleString()} active-client month${clientActivityEstimate.activeClientMonthDenominator === 1 ? "" : "s"} at the start of eligible fully covered months`
                : observed
                  ? `Inferred from sessions and new clients across ${observed.months} months, through ${observed.through}`
                  : `Based on your ${settings.retentionMonths}-month average client lifespan`}
            </small>
          </div>
          <button
            type="button"
            className="pw-button"
            disabled={suggestionInUse}
            onClick={() =>
              onSetting("baselineRetentionPct", 100 - suggestedAttrition)
            }
          >
            {suggestionInUse ? "Using estimate" : "Use estimate"}
          </button>
        </div>
        {!clientActivityEstimate && !observed && (
          <p>
            A session-based suggestion needs imported clients who returned to
            the same clinician or four consecutive months of complete team
            sessions and booked-client counts.
          </p>
        )}
        {observed && !clientActivityEstimate && (
          <p>
            This is a session-based estimate, not a measured exit count. It
            assumes each newly booked client contributes{" "}
            {settings.sessionsPerClientMonth} sessions in the booking month.
          </p>
        )}
        {clientActivityEstimate && hasObservedInactivityEstimate && (
          <p>
            A client is counted as a monthly loss when they cross 42 consecutive
            covered days without an attended session; a later attended session
            reactivates them. Inactivity is a proxy for loss, not a measured
            discharge. Clinician relationship inactivity is tracked separately:
            {clientActivityEstimate.inactiveRelationshipTransitions.toLocaleString()}{" "}
            relationship transition
            {clientActivityEstimate.inactiveRelationshipTransitions === 1
              ? ""
              : "s"}{" "}
            across{" "}
            {clientActivityEstimate.activeRelationshipMonthDenominator.toLocaleString()}{" "}
            active relationship-month
            {clientActivityEstimate.activeRelationshipMonthDenominator === 1
              ? ""
              : "s"}
            . The estimate does not infer exits from uncovered gaps;{" "}
            {clientActivityEstimate.rightCensoredClientPairs.toLocaleString()}{" "}
            pair
            {clientActivityEstimate.rightCensoredClientPairs === 1
              ? ""
              : "s"}{" "}
            are right-censored near the import end,{" "}
            {clientActivityEstimate.leftCensoredClientPairs.toLocaleString()}{" "}
            may have started before imported history, and{" "}
            {clientActivityEstimate.immatureClientPairsExcluded.toLocaleString()}{" "}
            first shows are inside the {14}-day maturity cutoff.
          </p>
        )}
      </div>
    </section>
  );
}
