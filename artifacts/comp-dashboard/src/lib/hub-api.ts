import {customFetch} from "@workspace/api-client-react";
import type {Workspace,Context} from "@workspace/practice/hub";
export type HubSnapshot={revision:number;data:Workspace;updatedAt:string|null};
export const hubKey=["business-hub"] as const;
export const getHub=()=>customFetch<HubSnapshot>("/api/hub");
export const getContext=()=>customFetch<Context>("/api/hub/context");
export const writeHub=(data:Workspace,revision:number,action:string,requestId:string)=>customFetch<HubSnapshot>("/api/hub",{method:"POST",body:JSON.stringify({data,expectedRevision:revision,action,requestId})});
export const approveProposal=(id:string,revision:number,changeIds:string[],requestId:string)=>customFetch<HubSnapshot>(`/api/hub/proposals/${id}/approve`,{method:"POST",body:JSON.stringify({expectedRevision:revision,changeIds,requestId})});
export function download(value:unknown,name:string,mime="application/json") {const blob=new Blob([typeof value==="string"?value:JSON.stringify(value,null,2)],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function exportCsv(rows:Record<string,string|number|null>[]){const response=await fetch("/api/hub/export-csv",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rows})});if(!response.ok)throw new Error("Export failed.");download(await response.text(),"emc-report.csv","text/csv");}
