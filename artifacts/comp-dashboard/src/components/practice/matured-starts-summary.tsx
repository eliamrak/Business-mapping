import type { MaturedStartsComparison } from '../../lib/retention-local.ts';
const number=(value:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(value);
/** Always visible, including when coverage cannot support the matched comparison. */
export function MaturedStartsSummary({comparison,label,endings,scale=0,monthCount}:{comparison?:MaturedStartsComparison;label?:string;endings?:number|null;scale?:number;monthCount?:number|null}) {
 const sharedScale=Math.max(scale,endings??0,comparison?.averageStarts??0);
 const bar=(value:number|null|undefined,kind:string)=>value==null?null:<div className="pw-attrition-bar-track" aria-hidden="true"><span className={`pw-attrition-bar-fill ${kind}`} style={{width:`${sharedScale>0?Math.min(100,Math.max(0,value/sharedScale*100)):0}%`}}/></div>;
 return <div data-state={endings==null?'unknown':'known'} className="pw-matured-starts-summary" aria-label={label?`${label} matched starts and endings`:`Average monthly client endings: ${endings==null?'unknown':number(endings)+' per covered mature month'}`}>
  {label&&<strong>{label}</strong>}
  <dl className="pw-attrition-starts"><div><dt>Matured starts / month</dt><dd>{comparison?.averageStarts==null?'Unknown':number(comparison.averageStarts)}</dd>{bar(comparison?.averageStarts,'starts')}</div><div><dt>Endings / month</dt><dd>{endings==null?'Unknown':number(endings)}</dd>{bar(endings,'endings')}</div><div data-direction={comparison?.difference==null?'unknown':comparison.difference>0?'positive':comparison.difference<0?'negative':'zero'}><dt>Starts minus endings / month</dt><dd>{comparison?.difference==null?'Unknown':`${comparison.difference>0?'+':''}${number(comparison.difference)}`}</dd></div></dl>
  {endings==null&&<span>Not enough covered history.</span>}
  <small>{comparison?.averageStarts==null?`Starts comparison unavailable.${monthCount==null?'':` ${monthCount} covered mature months.`}`:`${comparison.months.length} covered mature months.`} Evaluated first-observed starts; not net active growth.</small>
 </div>;
}
