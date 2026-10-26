/** Scenario flow balance only; never a measured active-caseload reconciliation. */
export function acquisitionScenario(target:string,endingsOverride:string,observedEndings:number|null|undefined,conversion:string){
 const count=(raw:string)=>raw.trim()!==''&&Number.isFinite(Number(raw))&&Number(raw)>=0?Number(raw):null;
 const goal=count(target),endings=endingsOverride.trim()===''?(observedEndings??null):count(endingsOverride);
 const rate=count(conversion);
 const starts=goal!==null&&endings!==null?goal+endings:null;
 const leads=starts!==null&&Number.isFinite(starts)&&rate!==null&&rate>0&&rate<=100?Math.ceil(starts/(rate/100)):null;
 return {goal,endings,starts:starts!==null&&Number.isFinite(starts)?starts:null,leads:leads!==null&&Number.isSafeInteger(leads)?leads:null,conversionPct:rate!==null&&rate>0&&rate<=100?rate:null};
}
