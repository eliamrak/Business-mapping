import test from 'node:test';
import assert from 'node:assert/strict';
import { acquisitionScenario } from './acquisition-scenario.ts';
import { acquisitionFunnel } from './acquisition-funnel.ts';
import { periodSchema, funnelSchema } from '@workspace/practice/hub';
test('interactive scenario example is explicit input, not factual defaults',()=>{
 assert.deepEqual(acquisitionScenario('5','8',null,'25'),{goal:5,endings:8,starts:13,leads:52,conversionPct:25});
 assert.equal(acquisitionScenario('','',null,'').leads,null);
 assert.equal(acquisitionScenario('5','',8,'25').leads,52);
 assert.equal(acquisitionScenario('0','0',8,'25').leads,0);
 assert.equal(acquisitionScenario('1','0',8,'30').leads,4);
});
test('unknown, zero conversion and invalid inputs cannot fabricate a lead requirement',()=>{
 for(const rate of ['','0','101','-1','NaN'])assert.equal(acquisitionScenario('5','8',null,rate).leads,null);
 assert.equal(acquisitionScenario('5','',null,'25').leads,null);
 assert.equal(acquisitionScenario('-5','8',null,'25').leads,null);
 assert.equal(acquisitionScenario('5','-8',null,'25').leads,null);
});
const period=periodSchema.parse({id:'11111111-1111-4111-8111-111111111111',name:'April',start:'2026-04-01',end:'2026-04-30',funnelComplete:true});
const row=funnelSchema.parse({id:'22222222-2222-4222-8222-222222222222',periodId:period.id,scope:'practice',spend:null,leads:40,scheduled:12,attended:10,clients:8,firstSessions:null});
test('reported conversion is an aligned aggregate ratio, never a matured cohort conversion',()=>{
 const workspace={periods:[period],funnels:[row]};
 assert.deepEqual(acquisitionFunnel(workspace,['2026-04']),{leads:40,averageLeads:40,bookedPerLeadPct:20});
 assert.equal(acquisitionFunnel(workspace,['2026-04','2026-05']).leads,null);
 assert.equal(acquisitionFunnel({...workspace,periods:[{...period,funnelComplete:false}]},['2026-04']).leads,null);
 assert.equal(acquisitionFunnel({...workspace,periods:[period,{...period,id:'duplicate'}]},['2026-04']).leads,null);
 assert.equal(acquisitionFunnel({...workspace,funnels:[row,{...row,scope:'source'}]},['2026-04']).leads,null);
 assert.deepEqual(acquisitionFunnel({...workspace,funnels:[{...row,leads:0,clients:0}]},['2026-04']),{leads:0,averageLeads:0,bookedPerLeadPct:null});
});

test('complete source breakdowns aggregate without duplicating totals and retain independent lead evidence',()=>{
 const source={...row,scope:'source' as const,sourceName:'Synthetic source',clinicianId:1};
 const workspace={periods:[period],funnels:[source,{...source,id:'other',clinicianId:2}]};
 assert.equal(acquisitionFunnel(workspace,['2026-04']).leads,80);
 assert.equal(acquisitionFunnel({...workspace,funnels:[source,source]},['2026-04']).leads,null);
 assert.equal(acquisitionFunnel({...workspace,funnels:[source,{...source,clinicianId:null}]},['2026-04']).leads,null);
 const independent=acquisitionFunnel({...workspace,funnels:[{...row,clients:null}]},['2026-04']);
 assert.equal(independent.leads,40);assert.equal(independent.bookedPerLeadPct,null);
});
