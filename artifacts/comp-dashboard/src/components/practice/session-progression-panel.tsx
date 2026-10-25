import { useId, useMemo, useState } from "react";
import { progressionPeriodRange, validProgressionRange, type ProgressionPeriod } from "../../lib/progression-period";
import { Download } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { progressionCsv } from "../../lib/session-progression-export";
import { sessionProgression, type ObservedLifetimeGroup, type SessionProgression } from "../../lib/session-progression";
import type { ClientActivityOptions, LocalSnapshot, SameDayVisitOverrides } from "../../lib/retention-local";
import type { CompleteReportCoverage } from "../../lib/complete-report-coverage";
import "./session-progression-panel.css";

export type SessionProgressionPanelProps = {
  snapshots: LocalSnapshot[];
  classificationSnapshots: LocalSnapshot[];
  excludedFollowUpEvidence: ClientActivityOptions["excludedFollowUpEvidence"];
  overrides: SameDayVisitOverrides;
  /** Legacy activity-window props are deliberately ignored; cohort state is independent. */
  start?: string;
  end?: string;
  asOf: string;
  clinician?: string;
  identityVerified?: boolean;
  comparisonMode?: boolean;
  coverage: CompleteReportCoverage | null;
};

const count = (value: number) => value.toLocaleString("en-US");
const pct = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}%`;
const change = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)} pp`;
const date = (value: string) => value === "0000-01-01" ? "earliest observed history" : new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function downloadCsv(result: SessionProgression) {
  const url = URL.createObjectURL(new Blob([progressionCsv(result)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `observed-session-progression-${result.start}-${result.end}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const observed = (value: number | null, unit: string) => value === null ? "—" : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${unit}`;

function LifetimeGroup({ title, detail, group }: { title: string; detail: string; group: ObservedLifetimeGroup }) {
  return <section className="pw-progression-lifetime-group" aria-label={title}>
    <header><h5>{title}</h5><span>{count(group.clients)} clients</span></header>
    <p>{detail}</p>
    <dl>
      <div><dt>Mean sessions</dt><dd>{observed(group.meanSessions, "sessions")}</dd></div>
      <div><dt>Median sessions</dt><dd>{observed(group.medianSessions, "sessions")}</dd></div>
      <div><dt>Mean elapsed time</dt><dd>{observed(group.meanElapsedDays, "days")}</dd></div>
      <div><dt>Median elapsed time</dt><dd>{observed(group.medianElapsedDays, "days")}</dd></div>
    </dl>
    <p className="pw-progression-lifetime-coverage">{count(group.coverageLimitedClients)} clients with limited continuous follow-up coverage.</p>
  </section>;
}

export function SessionProgressionPanel({ snapshots, classificationSnapshots, excludedFollowUpEvidence, overrides,
  asOf, clinician, identityVerified = true, comparisonMode = false, coverage }: SessionProgressionPanelProps) {
  const id = useId();
  const [milestones, setMilestones] = useState(8);
  const [period, setPeriod] = useState<ProgressionPeriod>("all");
  const [custom, setCustom] = useState({start: asOf.slice(0,4) + "-01-01", end: asOf});
  const [tableOpen, setTableOpen] = useState(false);
  const range = progressionPeriodRange(period, asOf, custom);
  const rangeValid = validProgressionRange(range, asOf);
  const {start, end} = rangeValid ? range : {start: asOf, end: asOf};
  const result = useMemo(() => sessionProgression(identityVerified && rangeValid ? snapshots : [], {
    start, end, asOf, clinician, sessions: milestones,
    sameDayVisitOverrides: overrides, classificationSnapshots, excludedFollowUpEvidence,
  }), [snapshots, classificationSnapshots, excludedFollowUpEvidence, overrides, start, end, asOf, clinician, milestones, identityVerified, rangeValid]);
  const tableId = `${id}-table`;
  const titleId = `${id}-title`;
  const captionId = `${id}-caption`;

  return <section className="pw-progression" aria-labelledby={titleId}>
    <header className="pw-progression-heading">
      <div>
        <span className="pw-progression-kicker">Retention · selected cohort</span>
        <h3 id={titleId}>Observed session progression</h3>
        <p>How many clients have reached each treatment session?</p>
      </div>
      <span className="pw-progression-scope">{clinician ?? "Whole Practice"}</span>
    </header>
    <div className="pw-progression-period">
      <label>Cohort starts <select aria-label="Progression cohort period" value={period} onChange={e => setPeriod(e.target.value as ProgressionPeriod)}>
        <option value="all">All available history</option><option value="year">Last year</option><option value="six-months">Last six months</option><option value="custom">Custom dates</option>
      </select></label>
      {period === "custom" && <><label>From <input aria-label="Progression cohort start" type="date" max={asOf} value={custom.start} onChange={e => setCustom({...custom,start:e.target.value})}/></label><label>Through <input aria-label="Progression cohort end" type="date" max={asOf} value={custom.end} onChange={e => setCustom({...custom,end:e.target.value})}/></label></>}
      <p>Independent of the Sessions activity period. All history means available eligible imports, not records before coverage.</p>
    </div>
    {!rangeValid && <p role="alert">Choose valid, ordered cohort dates no later than the observation cutoff.</p>}
    <p className="pw-progression-context" hidden={!rangeValid} id={captionId}>First observed treatment: <strong>{date(start)} – {date(end)}</strong>. Follow-up observed through <strong>{date(asOf)}</strong>, across clinicians. Clinician selection uses the first treatment date, not later referrals.</p>
    {comparisonMode && <p className="pw-progression-note">Showing the whole-practice cohort. Clinician cohorts can overlap and must not be summed.</p>}
    {!rangeValid ? null : !identityVerified ? <p className="pw-progression-empty" role="status">This clinician name maps to multiple records. Progression is unknown until the identity is resolved.</p> : <>
      <div className="pw-progression-overview">
        <div><span>Eligible cohort</span><strong>{count(result.eligibleClients)} <small>clients</small></strong></div>
        <p>Not yet reached does not mean dropped out. Recent and ongoing clients remain in the cohort.</p>
      </div>
      <div className="pw-progression-coverage" role="note">
        <strong>Observation is not complete lifetime history.</strong>{" "}
        Attendance report through {coverage?.attendanceThrough ? date(coverage.attendanceThrough) : "unknown"}; this is not proof of continuous coverage to the observation cutoff.
        {coverage && coverage.excludedRowsCount > 0 && <> {count(coverage.excludedRowsCount)} source rows excluded from eligible reports.</>}
        {result.clientsWithUnresolvedEvidence > 0 && <> {count(result.clientsWithUnresolvedEvidence)} cohort clients have unresolved follow-up evidence.</>}
      </div>
      {result.eligibleClients === 0 ? <p className="pw-progression-empty" role="status">No eligible clients had their first observed treatment in this date range{clinician ? ` with ${clinician}` : ""}. Try another cohort period. Unknown percentages are not zero retention.</p> : <figure className="pw-progression-figure" aria-labelledby={`${id}-chart-title`} aria-describedby={`${id}-chart-description`}>
        <figcaption id={`${id}-chart-title`}>Clients reaching each session</figcaption>
        <p className="pw-visually-hidden" id={`${id}-chart-description`}>Line chart of session number versus percentage of the same {count(result.eligibleClients)}-client cohort reaching that session. Exact counts and percentage-point changes are in the data table below.</p>
        <div className="pw-progression-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={result.rows} margin={{ top: 16, right: 20, bottom: 22, left: 2 }} accessibilityLayer>
              <CartesianGrid vertical={false} stroke="var(--pw-tone-border, #dce4e5)" strokeDasharray="3 4" />
              <XAxis dataKey="session" type="number" domain={[1, milestones]} allowDecimals={false} tickCount={Math.min(milestones, 8)} label={{ value: "Session number", position: "insideBottom", offset: -14, fill: "var(--pw-tone-text-muted, #59676a)" }} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={value => `${value}%`} width={48} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip content={({ active, payload }) => {
                const row = payload?.[0]?.payload as SessionProgression["rows"][number] | undefined;
                return active && row ? <div className="pw-progression-tooltip"><strong>Session {row.session}</strong><span>{count(row.completions)} of {count(row.eligibleClients)} clients · {pct(row.reachedPct)}</span><span>Change: {change(row.changePercentagePoints)}</span></div> : null;
              }} />
              <Line type="linear" dataKey="reachedPct" name="Clients reached" stroke="var(--pw-tone-positive, #276d65)" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>}
      <details className="pw-progression-data" open={tableOpen} onToggle={event => setTableOpen(event.currentTarget.open)}>
      <summary>Session progression data table</summary>
      <div className="pw-progression-data-heading">
        <h4>Data</h4>
        <div className="pw-progression-actions">
          <label>Show <select aria-label="Session milestones" value={milestones} onChange={event => setMilestones(Number(event.target.value))}>{[8, 12, 20, 30].map(value => <option key={value} value={value}>{value} sessions</option>)}</select></label>
          <button className="pw-button" type="button" onClick={() => downloadCsv(result)} disabled={result.eligibleClients === 0}><Download aria-hidden="true" />Export CSV</button>
        </div>
      </div>
      <p className="pw-progression-scroll-hint">On small screens, scroll the table horizontally to see all five columns.</p>
      <div className="pw-progression-table-scroll" role="region" aria-label="Session progression data; horizontally scrollable" tabIndex={0}>
        <table id={tableId} className="pw-progression-table" aria-describedby={captionId}>
          <caption className="pw-visually-hidden">Observed session progression. Eligible cohort is constant at every milestone; changes are percentage points, not relative percentages.</caption>
          <thead><tr><th scope="col">Session completed</th><th scope="col">Eligible cohort</th><th scope="col">Number reaching</th><th scope="col">% reached</th><th scope="col">Change from previous session <span>(percentage points)</span></th></tr></thead>
          <tbody>{result.rows.map(row => <tr key={row.session}><th scope="row">Session {row.session}</th><td>{count(row.eligibleClients)}</td><td>{count(row.completions)}</td><td>{pct(row.reachedPct)}</td><td>{change(row.changePercentagePoints)}</td></tr>)}</tbody>
        </table>
      </div>
      </details>
      <section className="pw-progression-lifetime" aria-labelledby={`${id}-lifetime-title`}>
        <h4 id={`${id}-lifetime-title`}>Observed client lifetime</h4>
        <p>Sessions and elapsed time observed in this same cohort — not expected eventual lifetime.</p>
        <div className="pw-progression-lifetime-grid">
          <LifetimeGroup title="Apparent endings (90-day rule)" detail="At least three distinct treatment dates and verified 90-day absence evidence. Not a confirmed discharge; clients may return." group={result.lifetime.apparentEndings} />
          <LifetimeGroup title="Ongoing or not classifiable as ended" detail="Includes recent/ongoing clients, fewer than three treatment dates, and uncertain coverage. Not all are known active; these observations are unfinished or unclassified." group={result.lifetime.ongoingOrCensored} />
        </div>
        <p className="pw-progression-lifetime-note">Elapsed time means calendar days from first to last observed treatment, not time through today. A same-day history is 0 days. Missing earlier history can shorten both groups’ observed lifetimes, even when follow-up coverage is complete.</p>
      </section>
    </>}
    <details className="pw-progression-method">
      <summary>How to read this</summary>
      <p>Clients enter this cohort on their first observed eligible treatment date in the selected period{clinician ? `, with ${clinician} on that first date` : ""}. Later visits count across clinicians through the observation cutoff, including after the cohort period. An internal referral does not restart the sequence.</p>
      <p>These are observed visits, not verified lifetime session ordinals. Missing earlier history can shift cohort membership and undercount use. Consultations and documentation are excluded; duplicate, conflicting attendance and explicit same-day exceptions follow the existing visit rules.</p>
      <p>The existing initial-retention rule still requires three distinct treatment dates with no initial gap over 28 days. This progression table includes clients who have only reached session 1 or 2; it does not replace retention or the separate 90-day apparent-ending measure.</p>
      {coverage && coverage.incompletePeriods.length > 0 && <p>{count(coverage.incompletePeriods.length)} incomplete or unverified report periods remain in source coverage. Their rows do not establish visits or absence. Review Data &amp; imports for the source gaps.</p>}
    </details>
  </section>;
}
