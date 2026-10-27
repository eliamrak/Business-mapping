
export * from './artifacts/comp-dashboard/src/lib/retention-local.ts';
export {completeReportCoverage} from './artifacts/comp-dashboard/src/lib/complete-report-coverage.ts';
export {snapshotsForClinicians,currentPracticeClinicians} from './artifacts/comp-dashboard/src/lib/practice-scope.ts';
export {buildImportedSessionOverlay} from './artifacts/comp-dashboard/src/lib/import-derived-sessions.ts';
export {completeServicePeriodState} from '@workspace/practice/hub';
export {sessionProgression} from './artifacts/comp-dashboard/src/lib/session-progression.ts';
import {derivedShowVisits} from './artifacts/comp-dashboard/src/lib/retention-local.ts';
import {completeReportCoverage} from './artifacts/comp-dashboard/src/lib/complete-report-coverage.ts';
import {snapshotsForClinicians,currentPracticeClinicians} from './artifacts/comp-dashboard/src/lib/practice-scope.ts';
import {buildImportedSessionOverlay} from './artifacts/comp-dashboard/src/lib/import-derived-sessions.ts';
import {completeServicePeriodState} from '@workspace/practice/hub';
export const sourceCommit='9865635faf427df7f9a10c479042c10493984a18';
// Composition from practice-workspace.tsx 894–940. No I/O or persistence.
export function admitClinicalInput({snapshots,workspace,context,asOf,declarations,sameDayVisitOverrides={}}){
 const team=context.clinicians.filter(p=>(p.goalId??null)===workspace.settings.teamId);
 const report=completeReportCoverage(snapshots,team,asOf,context.clinicians,{declarations,teamId:workspace.settings.teamId});
 const accepted=buildImportedSessionOverlay(context,report.eligibleSnapshots,workspace.settings.teamId,sameDayVisitOverrides,{declarations,classificationSnapshots:snapshots,billingEvidenceSnapshots:snapshots});
 const ids=team.map(p=>p.id);
 const state=completeServicePeriodState(accepted.context.sessions,ids,asOf,report.completeAttendanceCoverage.filter(r=>ids.includes(r.clinicianId)));
 const historicalSnapshots=snapshotsForClinicians(report.eligibleSnapshots,team);
 const roster=currentPracticeClinicians(workspace,context,asOf);
 const names=new Set(roster.map(p=>p.label.trim().replace(/\s+/g,' ').toLowerCase()));
 const visits=derivedShowVisits(historicalSnapshots,sameDayVisitOverrides,snapshots).filter(v=>v.serviceDate<=asOf);
 return {sourceCommit,roster,report,historicalSnapshots,visits,currentRosterVisits:visits.filter(v=>names.has(v.clinician.trim().replace(/\s+/g,' ').toLowerCase())) ,attendanceCoverage:state.eligibleCoverage,sessions:state.eligibleRecords,diagnostic:accepted.diagnostic};
}
