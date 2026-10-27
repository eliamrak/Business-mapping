import test from 'node:test';
import assert from 'node:assert/strict';
import {growthPace} from './growth-pace.ts';
test('four-month target normalizes monthly growth in weekly-session units to vertical',()=>{
 const result=growthPace(20,40,'5','4');
 assert.equal(result.gap,20);assert.equal(result.requiredGrowth,5);assert.equal(result.pacePct,100);assert.equal(result.angle,90);assert.equal(result.monthsToFill,4);
});
test('under/over pace retain exact percentage, angle saturates without falsifying time',()=>{
 assert.equal(growthPace(20,40,'2.5','4').angle,45);
 assert.equal(growthPace(20,40,'2.5','4').monthsToFill,8);
 const faster=growthPace(20,40,'10','4');assert.equal(faster.pacePct,200);assert.equal(faster.angle,90);assert.equal(faster.monthsToFill,2);
});
test('negative and zero growth never produce a misleading future fill time',()=>{
 const negative=growthPace(20,40,'-2.5','4');assert.equal(negative.status,'shrinking');assert.equal(negative.angle,-45);assert.equal(negative.monthsToFill,null);
 const flat=growthPace(20,40,'0','4');assert.equal(flat.status,'flat');assert.equal(flat.angle,0);assert.equal(flat.pacePct,0);assert.equal(flat.monthsToFill,null);
});
test('already full has no division or artificial pace percentage',()=>{
 for(const baseline of [40,45]){const result=growthPace(baseline,40,'','');assert.equal(result.status,'full');assert.equal(result.monthsToFill,0);assert.equal(result.pacePct,null);}
});
test('missing coverage, invalid desired capacity/horizon/growth remain unknown; covered zero is valid',()=>{
 for(const result of [growthPace(null,40,'5','4'),growthPace(20,null,'5','4'),growthPace(20,0,'5','4'),growthPace(20,40,'','4'),growthPace(20,40,'5','0'),growthPace(20,40,'NaN','4'),growthPace(20,40,'Infinity','4')])assert.equal(result.status,'unknown');
 assert.equal(growthPace(0,20,'5','4').status,'growing');
});
