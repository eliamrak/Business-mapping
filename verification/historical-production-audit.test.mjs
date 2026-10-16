import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {emptyWorkspace,prepareBillingChargeResolution} from '../lib/practice/src/hub/index.ts';
import {loadHistoricalAudit} from './historical-production-audit.mjs';
const {historicalProductionAudit}=await loadHistoricalAudit();
const options={start:'2025-07-01',end:'2026-10-12',asOf:'2026-10-16'};
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const workspace=emptyWorkspace('2026-10-01');
 const clinician={id:1,goalId:null,label:'SECRET_CURRENT',classification:'owner',sessionRate:100,sessionsPerWeek:7,weeksWorkedPerYear:52,capEnabled:false,capAmount:0,preCapClinicianSplit:0,preCapPracticeSplit:100,postCapClinicianSplit:0,postCapPracticeSplit:100,w2EmployerFicaPct:0,futaSutaPct:0,workersCompPct:0,otherEmployerBurdenPct:0};
 const row=(client,clinician,date,fee,hash)=>({clientId:client,clinician,serviceDate:date,totalFeeCharged:fee,billingCode:'90837',sourceRowHash:hash});
 const former=['(deleted) SECRET_FORMER_A','(deleted) SECRET_FORMER_B','(deleted) SECRET_FORMER_C'];
 const oldRows=Array.from({length:4},(_,i)=>[100,150].map((fee,j)=>row('SECRET_PAIR_'+i,clinician.label,`2026-01-0${i+2}`,fee,`SECRET_OLD_${i}_${j}`))).flat();
 oldRows.push(row('SECRET_JULY_B',former[1],'2025-07-01',25,'SECRET_B'),row('SECRET_JULY_C',former[2],'2025-07-10',30,'SECRET_C'),row('SECRET_OCT10',clinician.label,'2026-10-10',100,'SECRET_OCT10_OLD'));
 const newRows=[...oldRows.map(r=>({...r,sourceRowHash:r.sourceRowHash+'_NEW'})),row('SECRET_FIFTH',former[0],'2025-10-03',110,'SECRET_FIFTH_1'),row('SECRET_FIFTH',former[0],'2025-10-03',150,'SECRET_FIFTH_2'),row('SECRET_OCT12',clinician.label,'2026-10-12',100,'SECRET_OCT12')];
 // Fifth case is in October 2025, not October 2026.
 const snap=(id,rows,kind='billing')=>({id,kind,sourceHash:id.split('-')[1],coverageStart:'2025-07-01',coverageEnd:'2026-10-12',importedAt:'2026-10-16T20:00:55Z',rows});
 const old=snap('billing-aaaaaaaa',oldRows), latest=snap('billing-bbbbbbbb',newRows);
 const visit=(date,hash)=>({clientId:'SECRET_VISIT_'+date,clinician:clinician.label,serviceDate:date,status:'show',location:null,sourceRowHash:hash});
 const attendance=[snap('attendance-cccccccc',[visit('2026-10-10','SECRET_AOLD')],'attendance'),snap('attendance-dddddddd',[visit('2026-10-10','SECRET_ANEW'),visit('2026-10-12','SECRET_A12')],'attendance')];
 const snapshots=[old,latest,...attendance];
 const historicalBillingProviders=former.map((sourceLabel,i)=>({id:uuid(i+10),sourceLabel,sourceSets:[{snapshotIds:[old.id,latest.id],...options,asOf:undefined,complete:true}]}));
 for(const provider of historicalBillingProviders)delete provider.sourceSets[0].asOf;
 const declarations={version:1,mappings:[{sourceLabel:clinician.label,clinicianId:1,clinicianLabel:clinician.label,teamId:null}],sourceSets:[{kind:'billing',snapshotIds:[old.id,latest.id],clinicianIds:[1],start:options.start,end:options.end,complete:true},{kind:'attendance',snapshotIds:attendance.map(s=>s.id),clinicianIds:[1],start:options.start,end:options.end,complete:true}]};
 const approvals=Array.from({length:4},(_,i)=>({...prepareBillingChargeResolution(oldRows.filter(r=>r.clientId==='SECRET_PAIR_'+i).map(row=>({row,snapshotId:old.id}))),id:uuid(i+1),approvalToken:String(i+1).repeat(64),clinicianId:1,confirmedAt:'2026-10-16T00:00:00Z',approvalNote:'SECRET_NOTE'}));
 approvals.push({...prepareBillingChargeResolution(newRows.filter(r=>r.clientId==='SECRET_FIFTH').map(row=>({row,snapshotId:latest.id}))),id:uuid(5),approvalToken:'5'.repeat(64),historicalProviderId:uuid(10),confirmedAt:'2026-10-16T00:00:00Z',approvalNote:'SECRET_NOTE'});
 return {workspace,context:{clinicians:[clinician],staff:[],sessions:[]},goals:[],snapshots,overrides:{},declarations,declarationRevision:2,historicalBillingJournal:[{version:1,declarationRevision:2,providers:historicalBillingProviders}],billingResolutions:approvals};
}
test('historical aggregate matches independent arithmetic, five approvals, monthly/date scope and dedup without private output',()=>{
 const f=fixture(),before=structuredClone(f),r=historicalProductionAudit(f,options);
 assert.equal(r.wholePractice.reportedCharges,1515);assert.equal(r.wholePractice.reportDateCoverageComplete,true);assert.equal(r.months.length,16);
 assert.equal(r.months.find(m=>m.month==='2025-07').reportedCharges,55);assert.equal(r.months.find(m=>m.month==='2025-10').reportedCharges,260);assert.equal(r.months.find(m=>m.month==='2026-01').reportedCharges,1000);assert.equal(r.months.find(m=>m.month==='2026-10').reportedCharges,200);
 assert.equal(r.months.find(m=>m.month==='2025-08').reportedCharges,0);assert.equal(r.months.at(-1).fullCalendarMonthSelected,false);
 assert.deepEqual(r.historicalContributions.map(p=>p.reportedCharges),[260,25,30]);assert.equal(r.approvals.storedCount,5);assert.equal(r.approvals.appliedCasesInSelectedRange,5);assert.equal(r.approvals.historicalBindings,1);
 assert.equal(r.through.joint,'2026-10-07');assert.equal(r.octoberWindows[0].reportedCharges,100);assert.equal(r.octoberWindows[0].billingCollapsedDuplicateRows,1);assert.equal(r.octoberWindows[0].attendanceRawRows,2);assert.equal(r.octoberWindows[0].attendanceEncounterCandidates,1);assert.equal(r.octoberWindows[2].reportedCharges,100);
 assert.ok(r.octoberWindows.every(w=>!w.completeOperatingPeriod&&w.currentTeamAdmittedAttendanceRows===0));
 assert.doesNotMatch(JSON.stringify(r),/SECRET_|clientId|sourceRowHash|sourceHash|snapshotId|approvalToken|clinicianId|historicalProviderId/);assert.deepEqual(f,before);
});
test('unconfirmed identity, stale fifth anchor and frozen sources cannot certify affected totals',()=>{
 const f=fixture();f.historicalBillingJournal=[];let r=historicalProductionAudit(f,options);assert.equal(r.wholePractice.reportedCharges,null);assert.ok(r.scope.unknownProviderRows>0);
 const stale=fixture();stale.billingResolutions[4].charges[0].anchor.sourceRowHash='SECRET_CHANGED';r=historicalProductionAudit(stale,options);assert.equal(r.wholePractice.reportedCharges,null);assert.equal(r.approvals.staleCasesInSelectedRange,1);
 const frozen=fixture();frozen.declarations.sourceSets=[];for(const provider of frozen.historicalBillingJournal[0].providers)provider.sourceSets[0].snapshotIds=['billing-aaaaaaaa'];r=historicalProductionAudit(frozen,options);assert.equal(r.wholePractice.reportDateCoverageComplete,false);assert.ok(r.scope.unconfirmedSourceRows>0);assert.equal(r.through.joint,null);
});
test('production wrapper options and unexpected proof metadata never escape; missing historical sources withhold contributions',()=>{
 const f=fixture();f.snapshots[0].reportCoverage={start:'2025-07-01',end:'2026-10-12',complete:true,notes:'SECRET_PATIENT_NOTE'};
 let r=historicalProductionAudit(f,{...options,scope:'SECRET_PRACTICE'});assert.doesNotMatch(JSON.stringify(r),/SECRET_|scope.*SECRET/);assert.equal(r.range.scope,undefined);
 f.historicalBillingJournal[0].providers[0].sourceSets[0].snapshotIds=['billing-ffffffff'];r=historicalProductionAudit(f,options);
 assert.equal(r.wholePractice.reportedCharges,null);assert.equal(r.historicalContributions[0].sourceBindingsValid,false);assert.equal(r.historicalContributions[0].reportedCharges,null);assert.ok(r.historicalContributions[0].months.every(m=>m.charges===null));
});
test('CLI fails closed without acknowledgment or valid explicit dates and exposes no connection details',()=>{
 for(const args of [[],['--ack-existing-db-read-only']]){
 const r=spawnSync(process.execPath,['verification/historical-production-audit.mjs',...args],{encoding:'utf8',env:{PATH:process.env.PATH,DATABASE_URL:'postgres://SECRET_URL'}});assert.equal(r.status,1);assert.equal(r.stdout,'');assert.doesNotMatch(r.stderr,/SECRET_|postgres:/);assert.match(r.stderr,/historical_audit_failed_no_report/);
 }
});
