import test from 'node:test';import assert from 'node:assert/strict';
import {actionableImportLabels} from './import-warning-scope.ts';
test('routine departed exclusion does not hide active, unknown or ambiguous mapping errors',()=>{
 const roster=[{id:1,label:'Current'},{id:2,label:'Former'},{id:3,label:'Duplicate'},{id:4,label:'Duplicate'}];
 assert.deepEqual(actionableImportLabels(['Current',' former ','Unknown','Duplicate'],['Ambiguous'],roster,[1]),['Current','Unknown','Duplicate','Ambiguous']);
 assert.equal(roster.length,4);
});
