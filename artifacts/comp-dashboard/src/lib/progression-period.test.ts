import test from 'node:test';
import assert from 'node:assert/strict';
import {progressionPeriodRange,validProgressionRange} from './progression-period.ts';
test('progression defaults all available history and does not take global activity dates',()=>{
 assert.deepEqual(progressionPeriodRange('all','2026-10-25',{start:'2026-07-20',end:'2026-10-25'}),{start:'0000-01-01',end:'2026-10-25'});
 assert.deepEqual(progressionPeriodRange('six-months','2026-08-31',{start:'',end:''}),{start:'2026-02-28',end:'2026-08-31'});
 assert.deepEqual(progressionPeriodRange('year','2024-02-29',{start:'',end:''}),{start:'2023-02-28',end:'2024-02-29'});
});
test('custom progression cohort rejects incomplete, reversed, rollover and future dates',()=>{
 for(const range of [{start:'',end:'2026-01-01'},{start:'2026-02-30',end:'2026-03-01'},{start:'2026-03-02',end:'2026-03-01'},{start:'2026-01-01',end:'2026-10-26'}]) assert.equal(validProgressionRange(range,'2026-10-25'),false);
 assert.equal(validProgressionRange(progressionPeriodRange('all','2026-10-25',{start:'',end:''}),'2026-10-25'),true);
});
