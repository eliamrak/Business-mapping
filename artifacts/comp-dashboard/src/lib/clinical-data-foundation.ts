import { completeServicePeriodState, type Context, type Workspace, type ImportEvidenceDeclarations } from '@workspace/practice/hub';
import { completeReportCoverage } from './complete-report-coverage.ts';
import { buildImportedSessionOverlay } from './import-derived-sessions.ts';
import { currentPracticeClinicians, snapshotsForClinicians } from './practice-scope.ts';
import {
  derivedShowVisits, initialRetentionEpisode, periodClientAttritionEvidence, sameDayVisitKey,
  type LocalSnapshot, type ClientActivityOptions, type SameDayVisitOverrides,
} from './retention-local.ts';

const DAY = 86400000;
const stamp = (date: string) => Date.parse(date + 'T12:00:00Z');
const shift = (date: string, days: number) => new Date(stamp(date) + days * DAY).toISOString().slice(0, 10);
const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(stamp(date))
  && new Date(stamp(date)).toISOString().slice(0, 10) === date;
type Range = { start: string; end: string };
const covers = (ranges: readonly Range[], start: string, end = start) => ranges.some(range => range.start <= start && range.end >= end);
export type ClinicalFoundationInput = ClientActivityOptions & {
  /** Post-admission full historical snapshots, never date-filtered raw imports. */
  snapshots: LocalSnapshot[];
  sameDayVisitOverrides?: SameDayVisitOverrides;
  /** Explicit canonical roster labels resolved within the authenticated practice. */
  clinicianNames: readonly string[];
  /** Optional additional post-conflict calendar proof; cannot broaden snapshot proof. */
  attendanceCoverage?: readonly (Range & { clinician: string })[];
  start: string;
  end: string;
  asOf: string;
};
export type AttendanceBucket = Range & {
  coverageComplete: boolean;
  distinctClients: number | null;
  sessions: number | null;
};
type RetainedState = 'not-retained' | 'not-ended' | 'ended' | 'uncertain';

/** Internal index only: contains client identifiers. Never serialize it into logs,
 * public analytics, ad providers, or unauthenticated endpoints. Existing immutable
 * snapshot IDs/hashes remain provenance; no new persisted source of truth. */
export function buildClinicalObservationIndex(input: ClinicalFoundationInput) {
  if (![input.start, input.end, input.asOf].every(validDate) || input.start > input.end || input.end > input.asOf)
    throw new RangeError('Valid ordered dates through the observation cutoff are required.');
  const names = [...new Set(input.clinicianNames.map(normalize))];
  if (!names.length || names.some(name => !name)) throw new RangeError('Explicit nonempty clinician scope required.');
  const options = { classificationSnapshots: input.classificationSnapshots ?? input.snapshots,
    excludedFollowUpEvidence: input.excludedFollowUpEvidence ?? [] };
  const rawEvidence = periodClientAttritionEvidence(input.snapshots, input.asOf,
    { start: input.start, end: input.asOf }, input.sameDayVisitOverrides, options);
  const union = (ranges: readonly Range[]) => {
    const result: Range[]=[];
    for(const range of [...ranges].sort((a,b)=>a.start.localeCompare(b.start))) {
      const last=result.at(-1);
      if(last && stamp(range.start)<=stamp(last.end)+DAY) last.end=last.end>range.end?last.end:range.end;
      else result.push({...range});
    }
    return result;
  };
  let finalIntervals=rawEvidence.intervals;
  if(input.attendanceCoverage!==undefined) {
    // Absence/qualification must use the same final conflict-suppressed proof,
    // across ALL historical providers, not only today's selected roster.
    const historicalNames=new Set(input.snapshots.flatMap(snapshot=>snapshot.kind==='attendance'
      ? [...snapshot.rows.filter(row=>row.serviceDate<=input.asOf).map(row=>normalize(row.clinician)),...(snapshot.coverageClinicians??[]).map(normalize)] : []));
    for(const name of historicalNames) {
      const proof=union(input.attendanceCoverage.filter(row=>normalize(row.clinician)===name));
      finalIntervals=union(finalIntervals.flatMap(a=>proof.flatMap(b=>{
        const start=a.start>b.start?a.start:b.start,end=a.end<b.end?a.end:b.end;
        return start<=end?[{start,end}]:[];
      })));
    }
  }
  const evidence={intervals:finalIntervals,excluded:rawEvidence.excluded};
  const providerCoverage = names.map(name => periodClientAttritionEvidence(input.snapshots, input.asOf,
    { start: input.start, end: input.asOf }, input.sameDayVisitOverrides, options, name).intervals);
  const visits = derivedShowVisits(input.snapshots, input.sameDayVisitOverrides, options.classificationSnapshots)
    .filter(row => row.serviceDate <= input.asOf)
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.sourceRowHash.localeCompare(b.sourceRowHash));
  const clients = new Map<string, typeof visits>();
  for (const visit of visits) clients.set(visit.clientId, [...(clients.get(visit.clientId) ?? []), visit]);
  const indexedClients = [...clients].map(([clientId, clientVisits]) => {
    const dates = [...new Set(clientVisits.map(visit => visit.serviceDate))].sort();
    const initial = initialRetentionEpisode(dates, 28).initialEpisode;
    const retainedOn = initial.length >= 3 ? initial[2] : null;
    // Historical return flag only; current inactivity still uses the latest
    // admitted visit, exactly as the existing 90-day ending rule does.
    const returns = dates.filter((date, i) => i > 0 && date > shift(dates[i - 1], 90)
      && covers(evidence.intervals, shift(dates[i - 1], 1), shift(dates[i - 1], 90)));
    return { clientId, visits: clientVisits, dates, retainedOn, returns };
  });
  const scoped = (clinician: string) => names.includes(normalize(clinician));
  const scopeCovered = (start: string, end = start) => providerCoverage.every(ranges => covers(ranges, start, end))
    && (input.attendanceCoverage === undefined || names.every(name => {
      // Union adjacent final service-period proofs without broadening across gaps.
      let next = stamp(start);
      for(const range of (input.attendanceCoverage ?? []).filter(row=>normalize(row.clinician)===name).sort((a,b)=>a.start.localeCompare(b.start))) {
        if(stamp(range.start)>next) break;
        next=Math.max(next,stamp(range.end)+DAY);
      }
      return next>stamp(end);
    }));
  const inScopeAt = (client: typeof indexedClients[number], date: string) => {
    const last = client.dates.filter(value => value <= date).at(-1);
    return last !== undefined && client.visits.some(visit => visit.serviceDate === last && scoped(visit.clinician));
  };
  const stateAt = (client: typeof indexedClients[number], date: string): RetainedState => {
    if (!client.retainedOn || client.retainedOn > date) return 'not-retained';
    const last = client.dates.filter(value => value <= date).at(-1)!;
    // No future visits or unresolved observations may resolve an earlier cutoff.
    if (options.excludedFollowUpEvidence.some(row => row.clientId === client.clientId && row.serviceDate > last && row.serviceDate <= date)) return 'uncertain';
    if (!covers(evidence.intervals, client.dates[0], client.retainedOn)) return 'uncertain';
    const elapsed = shift(last, 90) <= date;
    if (elapsed) return covers(evidence.intervals, shift(last, 1), shift(last, 90)) ? 'ended' : 'uncertain';
    return 'not-ended';
  };
  const ordinal = new Map<string, number>();
  const sessionKeys = visits.map(visit => {
    const key = sameDayVisitKey(visit), count = (ordinal.get(key) ?? 0) + 1;
    ordinal.set(key, count);
    return { sessionKey: `${key}:${count}`, sourceRowHash: visit.sourceRowHash };
  });
  return { visits, indexedClients, evidence, providerCoverage, names, scoped, scopeCovered, inScopeAt, stateAt, sessionKeys };
}

/** Public aggregate DTO. All rates carry their actual denominators. This function
 * performs no IO, persistence, approvals, edits, or downstream planning changes. */
export function clinicalDataFoundation(input: ClinicalFoundationInput) {
  const index = buildClinicalObservationIndex(input);
  const bucket = (start: string, end: string): AttendanceBucket => {
    const coverageComplete = index.scopeCovered(start, end);
    const rows = index.visits.filter(visit => index.scoped(visit.clinician) && visit.serviceDate >= start && visit.serviceDate <= end);
    return { start, end, coverageComplete, distinctClients: coverageComplete ? new Set(rows.map(row => row.clientId)).size : null,
      sessions: coverageComplete ? rows.length : null };
  };
  const weeks: AttendanceBucket[] = [];
  const dayOfWeek = new Date(stamp(input.start)).getUTCDay();
  const firstMonday = shift(input.start, (8 - dayOfWeek) % 7);
  for (let date = firstMonday; shift(date, 6) <= input.end; date = shift(date, 7)) weeks.push(bucket(date, shift(date, 6)));
  const months: AttendanceBucket[] = [];
  for (let date = input.start.slice(0, 7) + '-01'; date <= input.end;) {
    const d = new Date(stamp(date)), next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    if (date >= input.start && shift(next, -1) <= input.end) months.push(bucket(date, shift(next, -1)));
    date = next;
  }
  const summarize = (buckets: AttendanceBucket[]) => {
    const covered = buckets.filter(row => row.coverageComplete);
    const sum = covered.reduce((value, row) => value + row.distinctClients!, 0);
    return { averageDistinctClients: covered.length ? sum / covered.length : null, sumDistinctClientBuckets: sum,
      denominator: covered.length, requestedCompleteBuckets: buckets.length, missingBuckets: buckets.length - covered.length, buckets };
  };
  const emptyPopulation = () => ({ retainedNotEnded: 0, apparentlyEnded: 0, uncertain: 0, returnedAfterVerifiedGap: 0, notInitiallyRetained: 0 });
  const population = emptyPopulation();
  const clinicianPopulations = index.names.map(clinician => ({ clinician, ...emptyPopulation() }));
  let sharedRetainedClients = 0;
  const add = (counts: ReturnType<typeof emptyPopulation>, client: typeof index.indexedClients[number]) => {
    const state = index.stateAt(client, input.asOf);
    if (state === 'not-ended') counts.retainedNotEnded++;
    else if (state === 'ended') counts.apparentlyEnded++;
    else if (state === 'uncertain') counts.uncertain++;
    else counts.notInitiallyRetained++;
    if(client.retainedOn && client.returns.some(date=>date<=input.asOf && date>client.retainedOn!)) counts.returnedAfterVerifiedGap++;
  };
  for (const client of index.indexedClients.filter(client => index.inScopeAt(client, input.asOf))) {
    add(population, client);
    const last = client.dates.at(-1)!;
    const latestProviders = new Set(client.visits.filter(visit=>visit.serviceDate===last).map(visit=>normalize(visit.clinician)));
    const attributed = clinicianPopulations.filter(row=>latestProviders.has(row.clinician));
    for(const clinician of attributed) add(clinician,client);
    if(attributed.length>1 && index.stateAt(client,input.asOf)==='not-ended') sharedRetainedClients++;
  }
  // A6 requires complete recent practice-wide follow-up, not merely the absence
  // of a recorded ending. The positive observed subset remains separately visible.
  const populationCoverageComplete = index.scopeCovered(shift(input.asOf, -90), input.asOf)
    && covers(index.evidence.intervals, shift(input.asOf, -90), input.asOf);
  const averageByClinician = index.names.map(clinician => ({ clinician, clientDays: 0, uncertainClientDays: 0 }));
  let retainedClientDays = 0, retainedSessions = 0, uncertainClientDays = 0, coveredDays = 0;
  for (let date = input.start; date <= input.end; date = shift(date, 1)) {
    if (!index.scopeCovered(date) || !covers(index.evidence.intervals, date)) continue;
    coveredDays++;
    for (const client of index.indexedClients) {
      if (!index.inScopeAt(client, date)) continue;
      const state = index.stateAt(client, date);
      const lastDate = client.dates.filter(value => value <= date).at(-1)!;
      const providers = new Set(client.visits.filter(visit => visit.serviceDate === lastDate).map(visit => normalize(visit.clinician)));
      for (const counts of averageByClinician.filter(counts => providers.has(counts.clinician))) {
        if (state === 'not-ended') counts.clientDays++;
        if (state === 'uncertain') counts.uncertainClientDays++;
      }
      if (state === 'uncertain') uncertainClientDays++;
      if (state !== 'not-ended') continue;
      retainedClientDays++;
      retainedSessions += client.visits.filter(visit => visit.serviceDate === date && index.scoped(visit.clinician)).length;
    }
  }
  const requestedDays = Math.round((stamp(input.end) - stamp(input.start)) / DAY) + 1;
  const averageCoverageComplete = coveredDays === requestedDays;
  return {
    contractVersion: 3 as const, sourceBasis: 'admitted-observed-treatment' as const,
    window: { start: input.start, end: input.end, asOf: input.asOf },
    scope: { clinicianNames: [...input.clinicianNames], populationMembership: 'latest-observed-treatment-provider' as const },
    provenance: { snapshots: input.snapshots.map(snapshot => ({ id: snapshot.id, kind: snapshot.kind, sourceHash: snapshot.sourceHash })),
      classificationSnapshots: (input.classificationSnapshots ?? input.snapshots).map(snapshot => ({ id: snapshot.id, sourceHash: snapshot.sourceHash })),
      sameDayOverrideCount: Object.keys(input.sameDayVisitOverrides ?? {}).length, unresolvedEvidenceCount: input.excludedFollowUpEvidence?.length ?? 0 },
    weekly: { ...summarize(weeks), boundary: 'Monday–Sunday; partial boundary weeks excluded' as const,
      excludedBoundaryDays: Math.round((stamp(input.end) - stamp(input.start)) / DAY) + 1 - weeks.length * 7 },
    monthly: { ...summarize(months), boundary: 'complete calendar months' as const },
    retainedPopulation: { ...population, coverageComplete: populationCoverageComplete,
      byClinician: clinicianPopulations.map(row=>({...row, coverageComplete:populationCoverageComplete,
        value:populationCoverageComplete && row.uncertain===0 ? row.retainedNotEnded : null})),
      qualification: 'practice-wide initial retention; not three visits per provider' as const,
      attribution: 'latest treatment date providers; same-day shared providers each receive a pair' as const,
      clinicianClientPairs: clinicianPopulations.reduce((sum,row)=>sum+row.retainedNotEnded,0),
      sharedRetainedClients,
      excessClinicianClientPairs: clinicianPopulations.reduce((sum,row)=>sum+row.retainedNotEnded,0)-population.retainedNotEnded,
      value: populationCoverageComplete && population.uncertain === 0 ? population.retainedNotEnded : null,
      definition: 'first-observed initial episode: 3 distinct treatment dates, gaps <=28 days; no verified 90-day ending' as const,
      returnPolicy: 'latest admitted treatment determines current inactivity; returns are separate from new initial starts or episode classification' as const },
    averageActiveCaseload: {
      formulaVersion: 'daily-initial-retained-not-inactive-v1' as const,
      value: averageCoverageComplete && uncertainClientDays === 0 ? retainedClientDays / requestedDays : null,
      clientDays: retainedClientDays, denominatorDays: requestedDays, coveredDays,
      coverageComplete: averageCoverageComplete, uncertainClientDays,
      byClinician: averageByClinician.map(row => ({ ...row,
        value: averageCoverageComplete && row.uncertainClientDays === 0 ? row.clientDays / requestedDays : null })),
      basis: 'calendar-day mean; initial retention qualified by each day; latest treatment +90 days > day; latest-provider attribution as of each day' as const,
      limitation: 'observed imported history only; unobserved earlier retention is not inferred' as const,
    },
    retainedAttendance: { sessions: retainedSessions, clientDays: retainedClientDays, clientWeeks: retainedClientDays / 7,
      coveredDays, requestedDays: Math.round((stamp(input.end) - stamp(input.start)) / DAY) + 1, uncertainClientDays,
      sessionsPerClientWeek: retainedClientDays > 0 && uncertainClientDays === 0 ? retainedSessions * 7 / retainedClientDays : null,
      basis: 'covered retained-not-ended client-days; includes quiet days; third qualifying date included; no future qualification' as const },
  };
}

/** Canonical application entry: reuses the existing admitted source pipeline.
 * Caller supplies already authorized practice/account data; this is not an auth
 * boundary or endpoint. No manual aggregate can manufacture client identities. */
export function derivePracticeClinicalMetrics(input: {
  snapshots: LocalSnapshot[]; workspace: Workspace; context: Context;
  declarations?: ImportEvidenceDeclarations; sameDayVisitOverrides?: SameDayVisitOverrides;
  start: string; end: string; asOf: string;
  scopeClinicianIds?: readonly number[];
}) {
  const {workspace,context,snapshots,asOf}=input;
  const team=context.clinicians.filter(person=>(person.goalId??null)===workspace.settings.teamId);
  const currentRoster=currentPracticeClinicians(workspace,context,asOf);
  if(input.scopeClinicianIds && (new Set(input.scopeClinicianIds).size!==input.scopeClinicianIds.length || input.scopeClinicianIds.some(id=>!currentRoster.some(person=>person.id===id)))) throw new RangeError('Clinician scope must reference unique current practice IDs.');
  const roster=input.scopeClinicianIds?currentRoster.filter(person=>input.scopeClinicianIds!.includes(person.id)):currentRoster;
  const report=completeReportCoverage(snapshots,team,asOf,context.clinicians,{declarations:input.declarations,teamId:workspace.settings.teamId});
  const accepted=buildImportedSessionOverlay(context,report.eligibleSnapshots,workspace.settings.teamId,input.sameDayVisitOverrides,
    {declarations:input.declarations,classificationSnapshots:snapshots,billingEvidenceSnapshots:snapshots});
  const ids=team.map(person=>person.id);
  const state=completeServicePeriodState(accepted.context.sessions,ids,asOf,report.completeAttendanceCoverage.filter(range=>ids.includes(range.clinicianId)));
  const admitted=snapshotsForClinicians(report.eligibleSnapshots,team);
  const excludedFollowUpEvidence=snapshots.flatMap(snapshot=>snapshot.kind==='attendance'?snapshot.rows.filter(row=>row.status==='show'&&!report.eligibleAttendanceRows.includes(row)).map(row=>({clientId:row.clientId,serviceDate:row.serviceDate})):[]);
  if(!roster.length) return {status:'unavailable' as const,reason:'No current clinician roster',metrics:null};
  const metrics=clinicalDataFoundation({...input,snapshots:admitted,classificationSnapshots:snapshots,excludedFollowUpEvidence,
    clinicianNames:roster.map(person=>person.label),attendanceCoverage:state.eligibleCoverage.flatMap(range=>{
      const person=team.find(person=>person.id===range.clinicianId);
      return person?[{start:range.start,end:range.end,clinician:person.label}]:[];
    })});
  return {status:'derived' as const,scope:{kind:input.scopeClinicianIds?'clinician-selection' as const:'whole-practice' as const,clinicianIds:roster.map(person=>person.id)},metrics,admission:{excludedRows:report.excludedRowsCount,statusConflicts:report.attendanceStatusConflictCount,
    sourceSnapshotCount:snapshots.length,admittedSnapshotCount:admitted.length,manualImportConflicts:accepted.diagnostic.manualImportConflictCount}};
}

/** Side-by-side calendar comparisons share one source version, current roster and
 * population cutoff. Daily average caseload uses each comparison window;
 * retainedPopulation remains a separate end-date snapshot. */
export function derivePracticeClinicalComparisons(input: Omit<Parameters<typeof derivePracticeClinicalMetrics>[0], 'start'|'end'> & {calendarThrough?:string}) {
  const through=input.calendarThrough??input.asOf;
  if(!validDate(through)||!validDate(input.asOf)||through>input.asOf) throw new RangeError('Calendar anchor must be valid and no later than asOf.');
  const date=new Date(stamp(through));
  const monthEnd=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).toISOString().slice(0,10);
  const nextMonth=date.getUTCMonth()+(through===monthEnd?1:0);
  const end=new Date(Date.UTC(date.getUTCFullYear(),nextMonth,0)).toISOString().slice(0,10);
  const window=(months:number)=>({start:new Date(Date.UTC(date.getUTCFullYear(),nextMonth-months,1)).toISOString().slice(0,10),end});
  return {contractVersion:3 as const,asOf:input.asOf,calendarThrough:through,
    populationComparisonBasis:'daily average uses each window; end-date snapshot shares as-of' as const,
    threeMonths:derivePracticeClinicalMetrics({...input,...window(3)}),
    twelveMonths:derivePracticeClinicalMetrics({...input,...window(12)})};
}
