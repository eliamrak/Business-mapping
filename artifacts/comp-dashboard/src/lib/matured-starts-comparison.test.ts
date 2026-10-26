import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMaturedStarts, estimateLocalClientActivity, buildLocalRetentionMetrics, type LocalSnapshot, type AttendanceRow } from './retention-local.ts';
const intervals = [{start:'2026-01-01',end:'2026-10-31'}];
const months = [{month:'2026-04',endedClients:1},{month:'2026-06',endedClients:0}];
test('matured starts include retained and mature non-retained, using exact non-contiguous ending months',()=>{
 const dates=new Map([['retained',['2026-04-01','2026-04-08','2026-04-15']],['nonretained',['2026-06-01']],['outside',['2026-05-01']],['older',['2026-03-01','2026-04-10']]]);
 assert.deepEqual(compareMaturedStarts(dates,intervals,months,28),{months:['2026-04','2026-06'],maturedStarts:2,averageStarts:1,averageEndings:.5,difference:.5});
});
test('zero is known only for covered months; no covered months or coverage gaps are unknown',()=>{
 assert.equal(compareMaturedStarts(new Map(),intervals,months,28).averageStarts,0);
 assert.equal(compareMaturedStarts(new Map(),intervals,[],28).averageStarts,null);
 assert.equal(compareMaturedStarts(new Map(),[{start:'2026-04-02',end:'2026-10-31'}],months,28).difference,null);
});
test('pending starts and unresolved follow-up cannot become zero or a partial denominator',()=>{
 const dates=new Map([['pending',['2026-04-29']]]);
 const april=[{month:'2026-04',endedClients:0}];
 assert.equal(compareMaturedStarts(dates,[{start:'2026-04-01',end:'2026-05-10'}],april,28).averageStarts,null);
 assert.equal(compareMaturedStarts(dates,intervals,april,28,[{clientId:'pending',serviceDate:'2026-05-01'}]).difference,null);
});
test('28-day episode maturity is unchanged, duplicates are distinct-date deduplicated, rounding uses raw totals',()=>{
 const dates=new Map([['one',['2026-04-01','2026-04-01','2026-04-29']],['later',['2026-04-01','2026-05-01','2026-05-08']]]);
 assert.equal(compareMaturedStarts(dates,[{start:'2026-04-01',end:'2026-05-26'}],[months[0]],28).averageStarts,null);
 const result=compareMaturedStarts(dates,intervals,[...months,{month:'2026-07',endedClients:0}],28);
 assert.equal(result.averageStarts,2/3);assert.equal(result.difference,1/3);
});
const visit=(clientId:string,date:string,clinician='Lane',billingCode='90837'):AttendanceRow=>({clientId,serviceDate:date,clinician,billingCode,status:'show',location:null,sourceRowHash:`${clientId}:${date}:${clinician}:${billingCode}`});
const source:LocalSnapshot={id:'synthetic',kind:'attendance',sourceHash:'synthetic',importedAt:'2026-11-01T00:00:00Z',coverageStart:'2026-01-01',coverageEnd:'2026-10-31',reportCoverage:{start:'2026-01-01',end:'2026-10-31',complete:true},coverageClinicians:['Lane','Moss'],rows:[visit('a','2026-04-01'),visit('a','2026-04-08'),visit('a','2026-04-15'),visit('a','2026-04-15'),visit('b','2026-04-01','Moss'),visit('phone','2026-04-01','Lane','PHONE'),visit('old','2026-03-01'),visit('old','2026-04-01')]};
test('integrated practice and clinician/date scopes use admitted treatment history and preserve input',()=>{
 const before=structuredClone(source);
 const practice=estimateLocalClientActivity([source],{},56,56,28,'2026-10-31',90,'2026-04-01','2026-04-30')!;
 assert.equal(practice.maturedStartsComparison?.maturedStarts,2);
 assert.equal(practice.maturedStartsComparison?.averageEndings,practice.averageClientEndingsPerFullMonth);
 const metrics=buildLocalRetentionMetrics([source],{},{},28,'2026-10-31',90,'2026-04-01','2026-04-30');
 assert.equal(metrics.clientActivityByClinician.find(row=>row.clinician==='Lane')?.maturedStartsComparison?.maturedStarts,1);
 assert.equal(metrics.clientActivityByClinician.find(row=>row.clinician==='Moss')?.maturedStartsComparison?.maturedStarts,1);
 assert.equal(estimateLocalClientActivity([source],{},56,56,28,'2026-10-31',90,'2026-06-01','2026-06-30')?.maturedStartsComparison?.averageStarts,0);
 assert.deepEqual(source,before);
});
