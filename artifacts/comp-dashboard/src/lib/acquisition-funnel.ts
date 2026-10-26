import type { Workspace } from '@workspace/practice/hub';
/** Complete, non-overlapping whole-practice monthly totals; never infer cohort linkage. */
export function acquisitionFunnel(workspace:Pick<Workspace,'periods'|'funnels'>|undefined,months:readonly string[]) {
 const unknown={leads:null,averageLeads:null,bookedPerLeadPct:null};
 if(!workspace||!months.length)return unknown;
 let leads=0,clients=0;
 for(const month of months){
  const start=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
  const overlapping=workspace.periods.filter(p=>!p.archived&&p.start<=end&&p.end>=start);
  if(overlapping.length!==1||overlapping[0].start!==start||overlapping[0].end!==end||!overlapping[0].funnelComplete)return unknown;
  const rows=workspace.funnels.filter(r=>r.periodId===overlapping[0].id);
  if(rows.length!==1||rows[0].scope!=='practice'||rows[0].clinicianId!==null||rows[0].leads===null||rows[0].clients===null)return unknown;
  leads+=rows[0].leads;clients+=rows[0].clients;
 }
 return {leads,averageLeads:leads/months.length,bookedPerLeadPct:leads>0&&clients<=leads?clients/leads*100:null};
}
