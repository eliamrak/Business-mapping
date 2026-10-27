import type { MaturedStartsComparison } from '../../lib/retention-local.ts';
const number=(value:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(value);
/** Always visible, including when coverage cannot support the matched comparison. */
export function MaturedStartsSummary({comparison,label}:{comparison?:MaturedStartsComparison;label?:string}) {
 return <div className="pw-matured-starts-summary" aria-label={label?`${label} matched starts and endings`:'Matched starts and endings'}>
  {label&&<strong>{label}</strong>}
  <dl className="pw-attrition-starts"><div><dt>Matured starts / month</dt><dd>{comparison?.averageStarts==null?'Unknown':number(comparison.averageStarts)}</dd></div><div><dt>Starts minus endings / month</dt><dd>{comparison?.difference==null?'Unknown':`${comparison.difference>0?'+':''}${number(comparison.difference)}`}</dd></div></dl>
  <small>{comparison?.averageStarts==null?'Starts comparison unavailable.':`${comparison.months.length} covered mature months.`} Evaluated first-observed starts; not net active growth.</small>
 </div>;
}
