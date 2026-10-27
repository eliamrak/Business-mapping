import type { Workspace } from '@workspace/practice/hub';
import { derivedShowVisits, type LocalSnapshot, type MaturedStartsComparison, type SameDayVisitOverrides } from './retention-local.ts';
import type { SessionAttendanceCoverage } from './session-trend.ts';
import type { HistoricalPerformancePeriods } from './historical-performance-periods.ts';
import { acquisitionFunnel } from './acquisition-funnel.ts';
import { growthPace } from './growth-pace.ts';
const day=86400000;
const stamp=(date:string)=>Date.parse(date+'T12:00:00Z');
const norm=(name:string)=>name.trim().replace(/\s+/g,' ').toLowerCase();
export type GrowthAttendanceMonth={month:string;index:number;sessions:number;weekly:number;attendees:number;clientWeeks:number};
/** Count admitted, deduplicated treatment visits only. Every selected provider must
 * have calendar coverage. Attendee-month exposure is a planning proxy, NOT an
 * active-caseload denominator: quiet clients are not counted as attending. */
export function growthAttendance(input:{snapshots:LocalSnapshot[];classificationSnapshots?:readonly LocalSnapshot[];overrides?:SameDayVisitOverrides;coverage:SessionAttendanceCoverage[];clinicians:{id:number;label:string}[];start:string;end:string;asOf:string}){
 const visits=derivedShowVisits(input.snapshots,input.overrides,input.classificationSnapshots??input.snapshots);
 const names=new Set(input.clinicians.map(p=>norm(p.label)));
 const months:GrowthAttendanceMonth[]=[];
 if(!input.clinicians.length||input.start>input.end)return months;
 const first=new Date(input.start+'T12:00:00Z');
 for(let index=0;index<120;index++){
  const start=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+index,1)).toISOString().slice(0,10);
  const end=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+index+1,0)).toISOString().slice(0,10);
  if(start>input.end)break;
  if(start<input.start||end>input.end||end>input.asOf)continue;
  const days=Math.round((stamp(end)-stamp(start))/day)+1;
  const covered=input.clinicians.every(person=>{
   const ranges=input.coverage.filter(c=>c.clinicianId===person.id&&c.start<=end&&c.end>=start).sort((a,b)=>a.start.localeCompare(b.start));
   let next=stamp(start);
   for(const range of ranges){if(stamp(range.start)>next)return false;next=Math.max(next,stamp(range.end)+day);}
   return next>stamp(end);
  });
  if(!covered)continue;
  const rows=visits.filter(v=>v.serviceDate>=start&&v.serviceDate<=end&&names.has(norm(v.clinician)));
  const attendees=new Set(rows.map(v=>v.clientId)).size;
  months.push({month:start.slice(0,7),index,sessions:rows.length,weekly:rows.length*7/days,attendees,clientWeeks:attendees*days/7});
 }
 return months;
}
/** Least-squares change in weekly workload per calendar month. Gaps retain their
 * calendar spacing. No manual growth rate and no substitution of client flows. */
export function workloadTrend(months:GrowthAttendanceMonth[]){
 if(months.length<2)return null;
 const x=months.reduce((s,m)=>s+m.index,0)/months.length,y=months.reduce((s,m)=>s+m.weekly,0)/months.length;
 const denominator=months.reduce((s,m)=>s+(m.index-x)**2,0);
 return denominator?months.reduce((s,m)=>s+(m.index-x)*(m.weekly-y),0)/denominator:null;
}
export type AutomaticGrowthInput=Parameters<typeof growthAttendance>[0]&{reports:HistoricalPerformancePeriods;workspace?:Pick<Workspace,'periods'|'funnels'>;capacity:number|null|undefined;horizon:string};
export function automaticGrowth(input:AutomaticGrowthInput){
 const summaries=Object.fromEntries((['3mo','year'] as const).map(period=>{
  const report=input.reports[period], range=report.window.cohort;
  const months=growthAttendance({...input,...range});
  const sessions=months.reduce((s,m)=>s+m.sessions,0),weeks=months.reduce((s,m)=>s+m.clientWeeks,0);
  const frequency=weeks>0?sessions/weeks:null;
  const trend=workloadTrend(months);
  const flow=report.attritionActivity?.maturedStartsComparison;
  const funnel=acquisitionFunnel(input.workspace,flow?.months??[]);
  const starts=flow?.averageStarts??null,ends=flow?.averageEndings??null;
  // Ratio is period aggregates, not linked lead cohorts; >1 is allowed and
  // displayed as starts per lead, never as a probability or percentage arc.
  const startsPerLead=starts!=null&&funnel.averageLeads!=null&&funnel.averageLeads>0?starts/funnel.averageLeads:null;
  return [period,{months,frequency,trend,flow,funnel,starts,ends,startsPerLead,range,closeRate:report.consults.practice.observedConversionRate,closeEvaluated:report.consults.practice.evaluated,closePending:report.consults.practice.pending}];
 })) as Record<'3mo'|'year',{months:GrowthAttendanceMonth[];frequency:number|null;trend:number|null;flow:MaturedStartsComparison|undefined;funnel:ReturnType<typeof acquisitionFunnel>;starts:number|null;ends:number|null;startsPerLead:number|null;range:{start:string;end:string};closeRate:number|null;closeEvaluated:number;closePending:number}>;
 // Same current baseline for both historical paces: latest available three
 // covered months, not different capacity gaps for each lookback window.
 const latest=summaries.year.months.slice(-3);
 const baseline=latest.length?latest.reduce((s,m)=>s+m.weekly,0)/latest.length:null;
 const periods=Object.fromEntries((['3mo','year'] as const).map(period=>{
  const summary=summaries[period];
  const pace=growthPace(baseline,input.capacity,summary.trend==null?'':String(summary.trend),input.horizon);
  if(summary.trend===null&&pace.status==='unknown'&&baseline!==null)pace.reason='At least two covered attendance months needed.';
  const additions=pace.requiredGrowth!=null&&summary.frequency!=null&&summary.frequency>0?pace.requiredGrowth/summary.frequency:pace.status==='full'?0:null;
  const requiredStarts=additions!=null&&summary.ends!=null?additions+summary.ends:null;
  const requiredLeads=requiredStarts===0?0:requiredStarts!=null&&summary.startsPerLead!=null&&summary.startsPerLead>0?requiredStarts/summary.startsPerLead:null;
  const reason=requiredLeads!=null?'Aggregate planning estimate':additions===null?'Covered attendance and positive client load needed':summary.ends===null?'Covered mature ending months needed':summary.funnel.averageLeads===null?'Complete lead totals needed for the same mature months':summary.startsPerLead===0?'No matured starts in the matched lead period':'Positive reported lead count needed';
  return [period,{...summary,pace,additions,requiredStarts,requiredLeads,reason}];
 })) as Record<'3mo'|'year',typeof summaries['3mo']&{pace:ReturnType<typeof growthPace>;additions:number|null;requiredStarts:number|null;requiredLeads:number|null;reason:string}>;
 return {baseline,baselineMonths:latest.map(m=>m.month),capacity:input.capacity??null,periods};
}
export type AutomaticGrowth=ReturnType<typeof automaticGrowth>;
