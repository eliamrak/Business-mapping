import { growthPace } from '../../lib/growth-pace.ts';
const number=(value:number|null|undefined)=>value==null?'Unknown':new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(value);
export function GrowthPaceCard({baseline,capacity,growth,horizon,onGrowth,onHorizon}:{baseline:number|null|undefined;capacity:number|null|undefined;growth:string;horizon:string;onGrowth:(value:string)=>void;onHorizon:(value:string)=>void}){
 const pace=growthPace(baseline,capacity,growth,horizon);
 const known=pace.status!=='unknown';
 const radians=pace.angle*Math.PI/180;
 return <section className="pw-metric-panel pw-growth-pace" aria-label="Growth pace scenario">
  <header><h2>Growth pace</h2><span>Whole practice · Scenario estimate</span></header>
  <div className="pw-growth-pace-summary">
   <figure className="pw-growth-pace-gauge" data-state={pace.status} role="img" aria-label={known?`${pace.status==='full'?'At desired workload':number(pace.pacePct)+'% of target pace'}; ${number(pace.angle)} degree goal-relative angle`:'Growth pace unknown'}>
    <svg viewBox="0 0 120 200" aria-hidden="true"><path d="M15 100H110 M15 10V190" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 5" opacity=".35"/>{known&&<path d={`M15 100L${15+85*Math.cos(radians)} ${100-85*Math.sin(radians)}`} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round"/>}<circle cx="15" cy="100" r="4" fill="currentColor"/></svg>
    <figcaption>{pace.status==='full'?'At target':pace.pacePct==null?'Unknown':`${number(pace.pacePct)}% of target pace`}</figcaption>
   </figure>
   <div><strong className="pw-growth-fill-time">{pace.status==='full'?'Already at desired workload':pace.monthsToFill==null?'Fill time unknown':`Estimated fill: ${number(pace.monthsToFill)} months`}</strong><p>{pace.reason}</p><p>{number(baseline)} → {number(capacity)} sessions / week</p><small>Baseline: covered 3-month average. Target: current desired workload.</small></div>
  </div>
  <div className="pw-growth-pace-controls"><label>Monthly growth assumption<input aria-label="Monthly growth in weekly sessions" type="number" step="any" value={growth} onChange={event=>onGrowth(event.target.value)} placeholder="Not set"/><small>Added sessions/week each month; negative means decline.</small></label><label>Target horizon (months)<input aria-label="Growth target horizon in months" type="number" min="0.1" step="any" value={horizon} onChange={event=>onHorizon(event.target.value)}/><small>Chosen planning target, not measured history.</small></label></div>
  <small>Session-only assumptions. Green means positive growth; the pace label shows whether it meets the target.</small>
  <details><summary>Model and limits</summary><p>Required monthly growth = remaining weekly workload ÷ target months. Pace = assumed growth ÷ required growth. 100% is vertical; larger values keep their numeric percentage but the angle stops at90°. Negative growth points downward. This is a normalized pace gauge, not a historical chart slope.</p><p>Assumes constant desired workload and monthly change in weekly sessions. Staffing, attendance and visit-frequency changes can alter the result. It does not use matured starts minus endings as measured active-client growth or predict when each clinician fills. No12-month growth trend has been inferred.</p></details>
 </section>;
}
