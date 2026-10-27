import type { AutomaticGrowth } from '../../lib/automatic-growth.ts';
const number=(value:number|null|undefined)=>value==null?'Unknown':Math.abs(value)>0&&Math.abs(value)<.005?(value<0?'−<0.01':'<0.01'):new Intl.NumberFormat('en-US',{maximumFractionDigits:Math.abs(value)<.1?2:1}).format(Object.is(value,-0)?0:value);
export function GrowthPaceCard({model,horizon,onHorizon}:{model:AutomaticGrowth;horizon:string;onHorizon:(value:string)=>void}){
 return <section className="pw-metric-panel pw-growth-pace" aria-label="Growth pace estimate">
  <header><h2>Growth pace</h2><span>Whole practice · Historical planning estimate</span></header>
  <p>{number(model.baseline)} → {number(model.capacity)} sessions / week</p>
  <div className="pw-growth-history-grid">{(['3mo','year'] as const).map(period=>{
   const {pace,trend,months}=model.periods[period],known=pace.status!=='unknown',radians=pace.angle*Math.PI/180;
   return <div key={period}><h3>{period==='3mo'?'Last 3 months':'Last 12 months'}</h3><div className="pw-growth-pace-summary">
    <figure className="pw-growth-pace-gauge" data-state={pace.status} role="img" aria-label={known?`${pace.status==='full'?'At desired workload':number(pace.pacePct)+'% of target pace'}; ${number(pace.angle)} degree goal-relative angle`:'Growth pace unknown'}>
     <svg viewBox="0 0 120 200" aria-hidden="true"><path d="M15 100H110 M15 10V190" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 5" opacity=".35"/>{known&&<path d={`M15 100L${15+85*Math.cos(radians)} ${100-85*Math.sin(radians)}`} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round"/>}<circle cx="15" cy="100" r="4" fill="currentColor"/></svg>
     <figcaption>{pace.status==='full'?'At target':pace.pacePct==null?'Unknown':`${number(pace.pacePct)}% of target pace`}</figcaption>
    </figure>
    <div><strong className="pw-growth-fill-time">{pace.status==='full'?'Already at desired workload':pace.status==='flat'||pace.status==='shrinking'?'Not filling at observed pace':pace.monthsToFill==null?'Fill time unavailable':`Estimated fill: ${number(pace.monthsToFill)} months`}</strong>{pace.status!=='flat'&&pace.status!=='shrinking'&&<p>{pace.reason}</p>}<p>{number(trend)} weekly sessions added / month</p><small>{months.length} covered attendance months</small></div>
   </div></div>;
  })}</div>
  <div className="pw-growth-pace-controls"><label>Target horizon (months)<input aria-label="Growth target horizon in months" type="number" min="0.1" step="any" value={horizon} onChange={event=>onHorizon(event.target.value)}/></label>
  <small>Chosen target; updates estimates only. Change clinician capacity in Long-Term Goals.</small></div>
  <details><summary>Model and coverage</summary><p>Baseline is the latest {model.baselineMonths.length} covered monthly attendance averages ({model.baselineMonths.join(', ')||'none'}), not a live caseload. Each pace uses a fitted trend in weekly treatment attendance across its covered months. Calendar gaps are not treated as zero. Required monthly growth = remaining weekly workload ÷ chosen horizon. 100% is vertical; angles stop at ±90° while numeric values remain visible.</p><p>Constant-trend, steady-state projections are estimates, not guarantees; acquisition lag and ramp-up are not modeled. Historical staffing, transfers and changing visit frequency can affect workload. This does not substitute starts minus endings for active-caseload growth.</p></details>
 </section>;
}
