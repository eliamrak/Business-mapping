import { automaticGrowth, type AutomaticGrowthInput } from './automatic-growth.ts';

/** Owner-declared desired weekly workload for the caller's authorized current
 * roster. No calendar permission/proof or fallback target is required. */
export function configuredWeeklyCapacity(clinicians: readonly {id:number;sessionsPerWeek:number}[]):number|null {
 if(!clinicians.length || new Set(clinicians.map(p=>p.id)).size!==clinicians.length
   || clinicians.some(p=>!Number.isFinite(p.sessionsPerWeek)||p.sessionsPerWeek<0)) return null;
 const total=clinicians.reduce((sum,p)=>sum+p.sessionsPerWeek,0);
 return Number.isFinite(total)?total:null;
}

/** Prepared adapter only. Recomputes both lookbacks from the same current roster
 * input on every call; never accepts a second capacity copy. Caller must supply
 * matching authorized scope/coverage/reports. Does not approve or change the
 * existing acquisition equations, and is not wired into live UI. */
export function automaticGrowthWithConfiguredCapacity(input:Omit<AutomaticGrowthInput,'capacity'|'clinicians'> & {
 clinicians:(AutomaticGrowthInput['clinicians'][number]&{sessionsPerWeek:number})[];
}) {
 return automaticGrowth({...input,capacity:configuredWeeklyCapacity(input.clinicians)});
}
