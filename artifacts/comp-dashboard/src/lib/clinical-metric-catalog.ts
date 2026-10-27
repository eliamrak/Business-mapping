import type { AutomaticGrowth } from './automatic-growth.ts';
import { acquisitionFunnel } from './acquisition-funnel.ts';
import { currentPracticeClinicians } from './practice-scope.ts';
import { derivePracticeClinicalComparisons } from './clinical-data-foundation.ts';

export type ClinicalMetricId = 'treatment_sessions'|'sessions_per_week'|'weekly_unique_attendees'|'monthly_unique_attendees'
  |'retained_not_ended'|'retained_sessions'|'retained_client_weeks'|'retained_sessions_per_client_week'
  |'all_attender_sessions_per_client_week'|'reported_leads'|'reported_leads_per_month'|'desired_weekly_capacity'|'provider_lead_requirement'|'matured_starts_per_month'|'apparent_endings_per_month'|'start_end_flow_balance'|'observed_consultation_close_rate'|'workload_growth_per_month'|'required_workload_growth_per_month'|'required_client_equivalents_per_month'|'required_matured_starts_per_month'|'required_leads_per_month'|'estimated_fill_months'|'target_pace_percent';
export type ClinicalMetric = {
  id:ClinicalMetricId; unit:string; value:number|null;
  status:'available'|'unavailable'; reason:string|null;
  formulaVersion:string; model:'observed'|'configured-target'|'proposed-retained'|'current-all-attender-proxy'|'current-acquisition-model';
  numerator:number|null; denominator:number|null;
  coveredDays:number|null; coveredBuckets:number|null;
};
type Comparisons=ReturnType<typeof derivePracticeClinicalComparisons>;
function metrics(result:Comparisons['threeMonths']):ClinicalMetric[]{
 const m=result.metrics;
 const make=(id:ClinicalMetricId,unit:string,value:number|null,numerator:number|null,denominator:number|null,
   model:ClinicalMetric['model']='observed',reason='Required covered source evidence unavailable',coveredDays:number|null=null,coveredBuckets:number|null=null):ClinicalMetric=>({id,unit,value,status:value===null?'unavailable':'available',reason:value===null?reason:null,formulaVersion:'clinical-foundation-v2',model,numerator,denominator,coveredDays,coveredBuckets});
 if(!m)return [make('retained_not_ended','clients',null,null,null,'observed','No current clinician scope')];
 const coveredMonths=m.monthly.buckets.filter(b=>b.coverageComplete);
 const days=coveredMonths.reduce((sum,b)=>sum+(Date.parse(b.end)-Date.parse(b.start))/86400000+1,0);
 const sessions=coveredMonths.reduce((sum,b)=>sum+b.sessions!,0);
 const clientWeeks=coveredMonths.reduce((sum,b)=>sum+b.distinctClients!*((Date.parse(b.end)-Date.parse(b.start))/86400000+1)/7,0);
 const retained=m.retainedAttendance;
 return [
  make('treatment_sessions','sessions',coveredMonths.length?sessions:null,sessions,1,'observed',undefined,days,coveredMonths.length),
  make('sessions_per_week','sessions/week',days?sessions*7/days:null,sessions,days/7,'observed',undefined,days,coveredMonths.length),
  make('weekly_unique_attendees','clients/week',m.weekly.averageDistinctClients,m.weekly.sumDistinctClientBuckets,m.weekly.denominator,'observed',undefined,m.weekly.denominator*7,m.weekly.denominator),
  make('monthly_unique_attendees','clients/month',m.monthly.averageDistinctClients,m.monthly.sumDistinctClientBuckets,m.monthly.denominator,'observed',undefined,days,m.monthly.denominator),
  make('retained_not_ended','clients',m.retainedPopulation.value,m.retainedPopulation.retainedNotEnded,1),
  make('retained_sessions','sessions',retained.coveredDays?retained.sessions:null,retained.sessions,1,'proposed-retained',undefined,retained.coveredDays),
  make('retained_client_weeks','client-weeks',retained.coveredDays?retained.clientWeeks:null,retained.clientDays,7,'proposed-retained',undefined,retained.coveredDays),
  make('retained_sessions_per_client_week','sessions/client/week',retained.sessionsPerClientWeek,retained.sessions,retained.clientWeeks,'proposed-retained','Covered retained exposure with no unresolved client-days needed',retained.coveredDays),
  make('all_attender_sessions_per_client_week','sessions/client/week',clientWeeks?sessions/clientWeeks:null,sessions,clientWeeks,'current-all-attender-proxy','Positive attendee-month exposure needed',days,coveredMonths.length),
  // Intentionally no division of practice totals by clinician headcount or workload.
  make('reported_leads','leads',null,null,null,'observed','Requires separately admitted funnel records; not inferred from clinical attendance'),
  make('provider_lead_requirement','leads/month',null,null,null,'observed','Requires recorded provider lead attribution and a reviewed acquisition formula'),
 ];
}
/** Versioned aggregate view over the existing database, not a second database.
 * Scope IDs and source/cutoff metadata accompany every metric set. No downstream
 * caller changes until review; unavailable non-clinical inputs are never guessed. */
export function deriveClinicalMetricCatalog(input:Parameters<typeof derivePracticeClinicalComparisons>[0] & {
 // Optional existing-engine output, never copied from practice into clinician slots.
 // Wiring caller must supply the same authorized source revision and scope.
 currentModels?:{asOf:string;practice?:AutomaticGrowth};
}){
 if(input.currentModels && 'clinicians' in input.currentModels) throw new RangeError('Clinician workflow models require source-bound scope provenance; adapter not enabled.');
 if(input.currentModels && input.currentModels.asOf!==input.asOf) throw new RangeError('Workflow model cutoff must match catalog cutoff.');
 const roster=currentPracticeClinicians(input.workspace,input.context,input.asOf);
 const derive=(ids?:number[])=>{
  const comparison=derivePracticeClinicalComparisons({...input,scopeClinicianIds:ids});
  const enrich=(result:Comparisons['threeMonths'],period:'3mo'|'year')=>{
    const rows=metrics(result),months=result.metrics?.monthly.buckets.filter(b=>b.coverageComplete).map(b=>b.start.slice(0,7))??[];
    const scopedFunnel=(selectedMonths:readonly string[])=>{
      let funnelWorkspace=input.workspace;
      if(ids){
        const periodIds=new Set(input.workspace.periods.filter(p=>selectedMonths.includes(p.start.slice(0,7))).map(p=>p.id));
        const inputs=input.workspace.funnels.filter(row=>periodIds.has(row.periodId));
        const fullyAttributed=inputs.length>0&&inputs.every(row=>row.scope==='source'&&row.clinicianId!==null);
        funnelWorkspace={...input.workspace,funnels:fullyAttributed?input.workspace.funnels.filter(row=>row.clinicianId===ids[0]):[]};
      }
      return acquisitionFunnel(funnelWorkspace,selectedMonths);
    };
    const funnel=scopedFunnel(months);
    const lead=rows.find(row=>row.id==='reported_leads');
    if(lead && funnel.leads!==null) Object.assign(lead,{value:funnel.leads,numerator:funnel.leads,denominator:1,status:'available',reason:null,formulaVersion:'recorded-funnel-v1',coveredBuckets:months.length});
    if(lead) rows.push({...lead,id:'reported_leads_per_month',unit:'leads/month',value:funnel.averageLeads,denominator:months.length||null});
    const people=ids?roster.filter(p=>ids.includes(p.id)):roster;
    const capacity=people.length&&people.every(p=>Number.isFinite(p.sessionsPerWeek)&&p.sessionsPerWeek>=0)?people.reduce((sum,p)=>sum+p.sessionsPerWeek,0):null;
    rows.push({id:'desired_weekly_capacity',unit:'sessions/week',value:capacity,numerator:capacity,denominator:1,status:capacity===null?'unavailable':'available',reason:capacity===null?'Current clinician desired sessions unavailable':null,formulaVersion:'configured-capacity-v1',model:'configured-target',coveredDays:null,coveredBuckets:null});
    const candidate=(ids?undefined:input.currentModels?.practice)?.periods[period];
    const current=candidate && candidate.range.start===result.metrics?.window.start && candidate.range.end===result.metrics?.window.end?candidate:undefined;
    const matchedFlowLeads=current?scopedFunnel(current.flow?.months??[]):null;
    const definitions:[ClinicalMetricId,string,number|null|undefined][]=[
      ['matured_starts_per_month','clients/month',current?.starts],
      ['apparent_endings_per_month','clients/month',current?.ends],
      ['start_end_flow_balance','clients/month',current?.flow?.difference],
      ['observed_consultation_close_rate','percent of evaluated consultations',current?.closeRate],
      ['workload_growth_per_month','weekly sessions/month',current?.trend],
      ['required_workload_growth_per_month','weekly sessions/month',current?.pace.requiredGrowth],
      ['required_client_equivalents_per_month','client equivalents/month',current?.additions],
      ['required_matured_starts_per_month','clients/month',current?.requiredStarts],
      ['required_leads_per_month','leads/month',current?.requiredLeads],
      ['estimated_fill_months','months',current?.pace.monthsToFill],
      ['target_pace_percent','percent of chosen target pace',current?.pace.pacePct],
    ];
    for(const [id,unit,raw] of definitions){
      const attributed=id!=='required_leads_per_month'||!ids||matchedFlowLeads?.leads!=null;
      const value=attributed && raw!=null && Number.isFinite(raw)?raw:null;
      rows.push({id,unit,value,status:value===null?'unavailable':'available',reason:value===null?(!attributed?'Recorded provider lead attribution required':current?.reason??(candidate?'Workflow calendar window differs; align source anchor before use':(ids?'Source-bound clinician acquisition engine pending review; no fallback assumed':'Existing practice workflow engine not connected; no fallback assumed'))):null,
        formulaVersion:'automatic-growth-v1',model:'current-acquisition-model',numerator:null,denominator:null,coveredDays:null,coveredBuckets:current?.months.length??null});
    }
    const providerTarget=rows.find(row=>row.id==='provider_lead_requirement');
    const requirement=rows.find(row=>row.id==='required_leads_per_month');
    if(ids && providerTarget && requirement?.value!=null) Object.assign(providerTarget,{...requirement,id:'provider_lead_requirement'});
    return {metrics:rows,workflowSource:current??null};
  };
  return {scope:ids?{kind:'clinician' as const,clinicianId:ids[0]}:{kind:'practice' as const},asOf:comparison.asOf,
    calendarThrough:comparison.calendarThrough,populationComparisonBasis:comparison.populationComparisonBasis,
    periods:{threeMonths:{source:comparison.threeMonths,...enrich(comparison.threeMonths,'3mo')},
      twelveMonths:{source:comparison.twelveMonths,...enrich(comparison.twelveMonths,'year')}}};
 };
 return {schemaVersion:1 as const,practice:derive(),clinicians:roster.map(person=>({clinicianId:person.id,label:person.label,...derive([person.id])})),
   aggregation:'Practice clients are unique; clinician scopes count clinician-client pairs and must not be summed as unique clients' as const,
   downstreamStatus:'not wired; retained-only formulas proposed for review' as const};
}
