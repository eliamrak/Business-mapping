export function growthPace(baseline:number|null|undefined,capacity:number|null|undefined,growth:string,horizon:string){
 const g=growth.trim()===''?null:Number(growth),h=horizon.trim()===''?null:Number(horizon);
 const result={status:'unknown' as 'unknown'|'full'|'growing'|'flat'|'shrinking',reason:'',gap:null as number|null,requiredGrowth:null as number|null,pacePct:null as number|null,angle:0,monthsToFill:null as number|null};
 if(baseline==null||!Number.isFinite(baseline)||baseline<0)return {...result,reason:'Covered workload baseline unavailable.'};
 if(capacity==null||!Number.isFinite(capacity)||capacity<=0)return {...result,reason:'Positive desired workload unavailable.'};
 const gap=Math.max(0,capacity-baseline);
 if(gap===0)return {...result,status:'full' as const,gap,monthsToFill:0,angle:90,reason:'At desired workload.'};
 if(h==null||!Number.isFinite(h)||h<=0)return {...result,gap,reason:'Enter a positive target horizon.'};
 const requiredGrowth=gap/h;
 if(g==null||!Number.isFinite(g))return {...result,gap,requiredGrowth,reason:'Set a monthly growth assumption.'};
 const pacePct=100*g/requiredGrowth,months=g>0?gap/g:null;
 if(!Number.isFinite(pacePct)||!Number.isFinite(requiredGrowth)||(months!==null&&!Number.isFinite(months)))return {...result,gap,reason:'Scenario is outside supported numeric range.'};
 return {...result,status:g>0?'growing' as const:g<0?'shrinking' as const:'flat' as const,gap,requiredGrowth,pacePct,angle:Math.max(-90,Math.min(90,pacePct*.9)),monthsToFill:months,reason:g>0?(pacePct>=100?'On or ahead of target pace.':'Behind target pace.'):'Not filling at this pace.'};
}
