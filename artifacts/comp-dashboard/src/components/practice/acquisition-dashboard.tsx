import type { AutomaticGrowth } from '../../lib/automatic-growth.ts';
const number=(value:number|null|undefined)=>value==null?'—':Math.abs(value)>0&&Math.abs(value)<.005?(value<0?'−<0.01':'<0.01'):new Intl.NumberFormat('en-US',{maximumFractionDigits:Math.abs(value)<.1?2:1}).format(Object.is(value,-0)?0:value);
function ActualCircle({value,label,rate=false}:{value:number|null|undefined;label:string;rate?:boolean}) {
 const arc=rate&&value!=null&&value>=0&&value<=100;
 return <figure className="pw-acquisition-circle" role="img" aria-label={`${label}: ${value==null?'Unknown':number(value)+(rate?'%':'')}${arc?'':'; unscaled count or unavailable'}`}><svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" opacity=".25" strokeWidth="3"/>{arc&&<circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" strokeWidth="3" pathLength="100" strokeDasharray={`${value} 100`} transform="rotate(-90 28 28)"/>}</svg><span aria-hidden="true">{number(value)}{rate&&value!=null?'%':''}</span></figure>;
}
export function AcquisitionDashboard({model}:{model:AutomaticGrowth}) {
 const periods=['3mo','year'] as const;
 const rows:{label:string;note?:string;rate?:boolean;get:(p:AutomaticGrowth['periods']['3mo'])=>number|null|undefined}[]=[
  {label:'Matured starts / month',note:'Evaluated first-observed starts',get:p=>p.starts},
  {label:'Apparent endings / month',note:'90-day rule',get:p=>p.ends},
  {label:'Starts minus endings / month',note:'Flow balance, not net active growth',get:p=>p.flow?.difference},
  {label:'Reported leads / month',get:p=>p.funnel.averageLeads},
  {label:'Reported leads → booked clients',note:'Reported ratio, not attended conversion',rate:true,get:p=>p.funnel.bookedPerLeadPct},
  {label:'Observed consultation close rate',note:'Evaluated consultations → scheduled follow-up',rate:true,get:p=>p.closeRate},
  {label:'Matured starts per 100 leads',note:'Matched-period planning ratio, not linked conversion',get:p=>p.startsPerLead==null?null:100*p.startsPerLead},
  {label:'Weekly sessions per attending client',note:'Attendee-month load estimate',get:p=>p.frequency},
  {label:'Weekly workload added / month',note:'Observed attendance trend',get:p=>p.trend},
  {label:'Additional client equivalents needed / month',note:'Capacity gap ÷ horizon ÷ observed weekly load',get:p=>p.additions},
  {label:'Estimated matured starts needed / month',note:'Client equivalents + observed endings',get:p=>p.requiredStarts},
  {label:'Estimated leads needed / month',note:'Historical aggregate planning estimate',get:p=>p.requiredLeads},
  {label:'Lead gap / month',note:'Estimated requirement − observed leads',get:p=>p.requiredLeads!=null&&p.funnel.averageLeads!=null?p.requiredLeads-p.funnel.averageLeads:null},
 ];
 return <section className="pw-metric-panel pw-acquisition-dashboard" aria-label="Acquisition dashboard">
  <header><h2>Client acquisition</h2><span>Goal: fill configured weekly capacity</span></header>
  <div className="pw-acquisition-table-wrap" role="region" aria-label="Acquisition metrics" tabIndex={0}><table><thead><tr><th scope="col">Metric</th><th scope="col">Last 3 months</th><th scope="col">Last 12 months</th></tr></thead><tbody>
   <tr><th scope="row">Covered months<small>Attendance / mature client flows</small></th>{periods.map(period=><td key={period}>{model.periods[period].months.length} / {model.periods[period].flow?.months.length??0}</td>)}</tr>
   {rows.map(row=><tr key={row.label}><th scope="row">{row.label}<small>{row.note}</small></th>{periods.map(period=><td key={period}><ActualCircle value={row.get(model.periods[period])} label={`${row.label} · ${period==='3mo'?'3 months':'12 months'}`} rate={row.rate}/></td>)}</tr>)}
   <tr><th scope="row">Lead estimate status</th>{periods.map(period=><td key={period}>{model.periods[period].reason}</td>)}</tr>
  </tbody></table></div>
  <p>Steady-state estimates; acquisition lag and ramp-up are not modeled. Client equivalents are not a reconciled active caseload.</p>
  <details><summary>Sources and planning limits</summary><p>Workload uses the current clinician roster and complete covered calendar months. Historical practice flows may include former clinicians. Applying that historical mix to current capacity is a planning assumption. Client flows and lead ratios use the same older mature months, allowing 90 days to observe apparent endings. Starts include retained and mature non-retained initial episodes; they are not all continuing clients. Endings are not confirmed discharges.</p><p>The capacity translation uses sessions per attending client-month, including time before and after visits within that month. It excludes clients with no attendance that month. Applying that average to future clients and adding apparent endings is a planning proxy, not a measured causal funnel. Reactivations, early losses, visit frequency and staffing changes can change the result. No client identity links reported marketing leads to treatment starts.</p>{periods.map(period=><p key={period}>{period==='3mo'?'3-month':'12-month'} attendance: {model.periods[period].months.map(m=>m.month).join(', ')||'Unavailable'}. Mature flow / lead months: {model.periods[period].flow?.months.join(', ')||'Unavailable'}.</p>)}{periods.map(period=><p key={'close-'+period}>{period==='3mo'?'3-month':'12-month'} observed close rate: {model.periods[period].closeEvaluated} evaluated consultations; {model.periods[period].closePending} unresolved. Qualifying scheduled appointments may later be cancelled or missed; this is not attended conversion.</p>)}<p>Google Ads and Meta Ads are not connected. Campaign data and owner-set goals remain unchanged.</p></details>
 </section>;
}
