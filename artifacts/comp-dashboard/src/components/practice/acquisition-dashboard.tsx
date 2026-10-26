import { useState, type ReactNode } from 'react';
import type { Workspace } from '@workspace/practice/hub';
import type { HistoricalPerformancePeriods } from '../../lib/historical-performance-periods.ts';
import { acquisitionScenario } from '../../lib/acquisition-scenario.ts';
import { acquisitionFunnel } from '../../lib/acquisition-funnel.ts';
const number=(value:number|null|undefined)=>value==null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(value);
function ActualCircle({value,label,rate=false}:{value:number|null|undefined;label:string;rate?:boolean}) {
 const arc=rate&&value!=null&&value>=0&&value<=100;
 return <figure className="pw-acquisition-circle" role="img" aria-label={`${label}: ${value==null?'Unknown':number(value)+(rate?'%':'')}${arc?'':'; unscaled count or unavailable'}`}><svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" opacity=".25" strokeWidth="3"/>{arc&&<circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" strokeWidth="3" pathLength="100" strokeDasharray={`${value} 100`} transform="rotate(-90 28 28)"/>}</svg><span aria-hidden="true">{number(value)}{rate&&value!=null?'%':''}</span></figure>;
}
export function AcquisitionDashboard({reports,target,onTarget,workspace,conversion="",onConversion,endings="",onEndings}:{reports:HistoricalPerformancePeriods;target:string;onTarget:(value:string)=>void;workspace?:Pick<Workspace,'periods'|'funnels'>;conversion?:string;onConversion?:(value:string)=>void;endings?:string;onEndings?:(value:string)=>void}) {
 const [period,setPeriod]=useState<'3mo'|'year'>('3mo');
 const source=reports[period].attritionActivity,comparison=source?.maturedStartsComparison,months=comparison?.months??[];
 const funnel=acquisitionFunnel(workspace,months);
 const validTarget=target===''||(Number.isFinite(Number(target))&&Number(target)>=0);
 const scenario=acquisitionScenario(target,endings,source?.averageClientEndingsPerFullMonth,conversion);
 const rows:{label:string;value:number|null|undefined;note?:string;rate?:boolean;goal?:ReactNode;gap?:number|null}[]=[
  {label:'Matured starts / month',value:comparison?.averageStarts,note:'Evaluated first-observed starts',gap:scenario.starts!=null&&comparison?.averageStarts!=null?scenario.starts-comparison.averageStarts:null},
  {label:'Apparent endings / month',value:source?.averageClientEndingsPerFullMonth,note:'Observed · 90-day rule',goal:<input aria-label="Expected endings per month" type="number" min="0" step="any" placeholder={number(source?.averageClientEndingsPerFullMonth)} value={endings} onChange={event=>onEndings?.(event.target.value)}/>},
  {label:'Starts minus endings / month',value:comparison?.difference,note:'Flow balance, not net active growth'},
  {label:'Reported leads / month',value:funnel.averageLeads,note:funnel.leads==null?'Complete practice totals needed':`${number(funnel.leads)} reported leads in these months`},
  {label:'Reported leads → booked clients',value:funnel.bookedPerLeadPct,rate:true,note:'Reported ratio, not matured conversion'},
  {label:'Net active additions / month',value:null,note:'Actual not yet reconciled',goal:<input aria-label="Target net additional clients per month" inputMode="decimal" type="number" min="0" step="any" placeholder="—" value={target} aria-invalid={!validTarget} onChange={event=>onTarget(event.target.value)}/>},
  {label:'Assumed leads → matured starts',value:scenario.conversionPct,rate:true,note:'Scenario assumption',goal:<input aria-label="Assumed lead to matured start conversion percent" type="number" min="0" max="100" step="any" placeholder="%" value={conversion} onChange={event=>onConversion?.(event.target.value)}/>},
  {label:'Estimated matured starts needed / month',value:scenario.starts,note:'Goal + expected endings'},
  {label:'Estimated leads needed / month',value:scenario.leads,note:'Scenario · rounded up'},
 ];
 return <section className="pw-metric-panel pw-acquisition-dashboard" aria-label="Acquisition dashboard">
  <header><h2>Client acquisition</h2><label>Comparison period<select aria-label="Acquisition comparison period" value={period} onChange={event=>setPeriod(event.target.value as '3mo'|'year')}><option value="3mo">Last 3 mature months</option><option value="year">Last 12 mature months</option></select></label></header>
  <p>Whole practice · {months.length?`${months.length} covered mature months`:'Not enough covered history'}</p>
  <div className="pw-acquisition-table-wrap" role="region" aria-label="Acquisition metrics" tabIndex={0}><table><thead><tr><th scope="col">Metric</th><th scope="col">Value</th><th scope="col">Plan</th><th scope="col">Gap</th></tr></thead><tbody>{rows.map(row=><tr key={row.label}><th scope="row">{row.label}<small>{row.note}</small></th><td><ActualCircle value={row.value} label={row.label} rate={row.rate}/></td><td>{row.goal??'—'}</td><td>{row.gap==null?'—':`${row.gap>0?'+':''}${number(row.gap)}`}</td></tr>)}</tbody></table></div>
  <small>Plan inputs are session-only. Empty endings uses the observed average. — means unavailable; count circles are unscaled.</small>
  {!validTarget&&<p role="alert">Enter a target of zero or more.</p>}
  <p>Planning balance, not guaranteed active-client growth.</p>
  <details><summary>Measurement details</summary><p>Starts include retained and mature non-retained initial episodes under the existing 28-day rule. Endings use the existing 90-day gap rule. Both averages use the same covered months; a client may occur in both counts. Earlier treatment history may be missing.</p><p>Net active additions also need reactivations and consistent active-client entries and exits. Internal transfers cancel across the whole practice. Reported lead ratios use complete whole-practice monthly totals, not linked acquisition cohorts. Current booked-client close rates do not measure lead-to-matured-start conversion.</p><p>Google Ads and Meta Ads are not connected here. Future ad-reported leads must remain distinct from linked client outcomes; clinical details must not be sent to ad platforms.</p></details>
 </section>;
}
