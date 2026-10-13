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
  const activitySuggestedAttrition = clientActivityEstimate?.endingAttritionPct;
  const suggestedAttrition = rounded(
    activitySuggestedAttrition ?? observed?.attritionPct ?? lifespanRate,
  );
  const suggestionInUse = sameEstimate(attrition, suggestedAttrition);
  const suggestedSessionsPerMonth =
    clientActivityEstimate?.observedAttendedSessionsPerMonth;
  const suggestedRetentionMonths = undefined;
  const suggestedSessionCount =
    clientActivityEstimate?.observedAttendedSessionsPerRetainedClient;
  const hasReturnFrequencyEstimate =
    suggestedSessionCount !== null &&
    suggestedSessionCount !== undefined &&
    suggestedSessionsPerMonth !== null &&
    suggestedSessionsPerMonth !== undefined;
  const averageClientEndings =
    clientActivityEstimate?.averageClientEndingsPerLatestSixMonths ??
    clientActivityEstimate?.averageClientEndingsPerFullMonth;
  const hasObservedEndingEstimate =
    clientActivityEstimate?.endingAttritionPct !== null &&
    clientActivityEstimate?.endingAttritionPct !== undefined;
  const endingFullMonthRange =
    clientActivityEstimate &&
    clientActivityEstimate.monthlyEndedClients.length > 0
      ? `${clientActivityEstimate.monthlyEndedClients[0].month} to ${clientActivityEstimate.monthlyEndedClients.at(-1)?.month}`
      : null;
  const initialRetentionDenominator =
    clientActivityEstimate?.initialRetentionDenominator ?? 0;
  const initialRetentionPct =
    clientActivityEstimate?.initialRetentionRate === null ||
    clientActivityEstimate?.initialRetentionRate === undefined
      ? null
      : clientActivityEstimate.initialRetentionRate * 100;

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
            <span>Initial retention rate</span>
            <strong>
              {initialRetentionPct === null
                ? "--"
                : `${initialRetentionPct.toFixed(1)}%`}
            </strong>
            <small>
              {initialRetentionDenominator > 0
                ? `${clientActivityEstimate.retainedClientPairs.toLocaleString()} retained / ${initialRetentionDenominator.toLocaleString()} mature initial client start${initialRetentionDenominator === 1 ? "" : "s"}; ${clientActivityEstimate.immatureClientPairsExcluded.toLocaleString()} pending.`
                : `${clientActivityEstimate.immatureClientPairsExcluded.toLocaleString()} initial client start${clientActivityEstimate.immatureClientPairsExcluded === 1 ? "" : "s"} still pending enough follow-up.`}
            </small>
          </div>
          <div>
            <span>Observed visits per returning client</span>
            <strong>
              {suggestedSessionCount === null ||
              suggestedSessionCount === undefined
                ? "--"
                : rounded(suggestedSessionCount).toFixed(1)}
            </strong>
            <small>
              {hasReturnFrequencyEstimate
                ? "Observed-to-date count, not a lifetime total."
                : "Needs a later-date return visit for the same clinician."}
            </small>
          </div>
          <div>
            <span>Client endings / month</span>
            <strong>
              {averageClientEndings === null ||
              averageClientEndings === undefined
                ? "--"
                : rounded(averageClientEndings).toFixed(1)}
            </strong>
            <small>
              {clientActivityEstimate.averageClientEndingsPerLatestSixMonths !==
                null && clientActivityEstimate.latestSixEndingMonths.length > 0
                ? `${clientActivityEstimate.latestSixClientEnds.toLocaleString()} established-client final session${clientActivityEstimate.latestSixClientEnds === 1 ? "" : "s"} across latest ${clientActivityEstimate.latestSixEndingMonths.length.toLocaleString()} full month${clientActivityEstimate.latestSixEndingMonths.length === 1 ? "" : "s"}, ${clientActivityEstimate.latestSixEndingMonths[0]} to ${clientActivityEstimate.latestSixEndingMonths.at(-1)}.`
                : endingFullMonthRange
                  ? `${clientActivityEstimate.endingFullMonthClientEnds.toLocaleString()} established-client final session${clientActivityEstimate.endingFullMonthClientEnds === 1 ? "" : "s"} across ${clientActivityEstimate.endingFullMonthDenominator.toLocaleString()} full month${clientActivityEstimate.endingFullMonthDenominator === 1 ? "" : "s"}, ${endingFullMonthRange}.`
                  : "Needs complete follow-up after final attended treatment dates."}
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
          estimateLabel="Returning client attendance frequency"
          onUseEstimate={
            suggestedSessionsPerMonth === undefined ||
            suggestedSessionsPerMonth === null
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
        {clientActivityEstimate && hasReturnFrequencyEstimate ? (
          <p>
            Visit-frequency estimate: practice clients who reached a
            third attended treatment visit; observed visit count is the average
            imported before that retention threshold. Initial retention uses
            three attended treatment dates without a gap longer than{" "}
            {clientActivityEstimate.initialRetentionGapDays} covered days;
            later returns after an initial non-retention gap are tracked
            separately and do not change the first-start denominator. Monthly
            frequency is derived attended visits divided by each history's
            covered month-equivalent span from first visit to retention.
          </p>
        ) : clientActivityEstimate ? (
          <p>
            Visit-frequency estimates need practice client histories with at
            least three attended treatment visits within the{" "}
            {clientActivityEstimate.initialRetentionGapDays}-day initial gap
            rule. Pending starts are excluded until the import coverage can
            observe the full follow-up window.
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
              {hasObservedEndingEstimate
                ? "Observed ending-based monthly attrition"
                : "Suggested monthly attrition"}
            </span>
            <strong>{suggestedAttrition.toFixed(1)}%</strong>
            <small>
              {clientActivityEstimate && hasObservedEndingEstimate
                ? `${rounded(averageClientEndings ?? 0).toFixed(1)} expected established-client final session${rounded(averageClientEndings ?? 0) === 1 ? "" : "s"} per month / latest complete ending month active established clients`
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
        {clientActivityEstimate && hasObservedEndingEstimate && (
          <p>
            An established client is counted in their final attended treatment
            month only after{" "}
            {clientActivityEstimate.endingGapDays.toLocaleString()} complete
            covered days with no later attended treatment session. The current
            ending cutoff is {clientActivityEstimate.endingObservationCutoff},
            based on continuous coverage through{" "}
            {clientActivityEstimate.endingCoverageEnd}; later imported returns
            remove earlier apparent endings.{" "}
            {clientActivityEstimate.partialEndingMonth
              ? `${clientActivityEstimate.partialEndingMonth.endedClients.toLocaleString()} final session${clientActivityEstimate.partialEndingMonth.endedClients === 1 ? "" : "s"} appear in the partial cutoff month ${clientActivityEstimate.partialEndingMonth.month} through ${clientActivityEstimate.partialEndingMonth.through}; partial months are shown separately. `
              : ""}
            All full months average{" "}
            {clientActivityEstimate.averageClientEndingsPerFullMonth === null
              ? "--"
              : rounded(
                  clientActivityEstimate.averageClientEndingsPerFullMonth,
                ).toFixed(1)}{" "}
            endings/month from{" "}
            {clientActivityEstimate.endingFullMonthClientEnds.toLocaleString()}{" "}
            ending
            {clientActivityEstimate.endingFullMonthClientEnds === 1 ? "" : "s"}{" "}
            across{" "}
            {clientActivityEstimate.endingFullMonthDenominator.toLocaleString()}{" "}
            full month
            {clientActivityEstimate.endingFullMonthDenominator === 1
              ? ""
              : "s"}
            ; latest-six-month average is{" "}
            {clientActivityEstimate.averageClientEndingsPerLatestSixMonths ===
            null
              ? "--"
              : rounded(
                  clientActivityEstimate.averageClientEndingsPerLatestSixMonths,
                ).toFixed(1)}{" "}
            from {clientActivityEstimate.latestSixClientEnds.toLocaleString()}{" "}
            ending
            {clientActivityEstimate.latestSixClientEnds === 1 ? "" : "s"}{" "}
            across{" "}
            {clientActivityEstimate.latestSixEndingMonths.length.toLocaleString()}{" "}
            full month
            {clientActivityEstimate.latestSixEndingMonths.length === 1
              ? ""
              : "s"}{" "}
            {clientActivityEstimate.latestSixEndingMonths.length > 0
              ? `(${clientActivityEstimate.latestSixEndingMonths[0]} to ${clientActivityEstimate.latestSixEndingMonths.at(-1)})`
              : ""}
            . These are confirmed no-return endings in imported coverage, not
            permanent discharge records.{" "}
            {clientActivityEstimate.endingLeftCensoredEstablishedClients.toLocaleString()}{" "}
            established client
            {clientActivityEstimate.endingLeftCensoredEstablishedClients === 1
              ? ""
              : "s"}{" "}
            may be left-censored at the beginning of imported history, and{" "}
            {clientActivityEstimate.immatureClientPairsExcluded.toLocaleString()}{" "}
            first shows are inside the{" "}
            {clientActivityEstimate.initialRetentionGapDays}-day initial
            retention follow-up window.{" "}
            {clientActivityEstimate.initialNonRetainedLaterReturnPairs.toLocaleString()}{" "}
            mature initial non-retention
            {clientActivityEstimate.initialNonRetainedLaterReturnPairs === 1
              ? ""
              : "s"}{" "}
            later returned after that gap.
          </p>
        )}
      </div>
    </section>
  );
}
