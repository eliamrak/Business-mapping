import test from 'node:test';import assert from 'node:assert/strict';
import {actionableImportLabels} from './import-warning-scope.ts';
test('routine departed exclusion does not hide active, unknown or ambiguous mapping errors',()=>{
 const roster=[{id:1,label:'Current'},{id:2,label:'Former'},{id:3,label:'Duplicate'},{id:4,label:'Duplicate'}];
 assert.deepEqual(actionableImportLabels(['Current',' former ','Unknown','Duplicate'],['Ambiguous'],roster,[1]),['Current','Unknown','Duplicate','Ambiguous']);
 assert.equal(roster.length,4);
});

test('explicit billing-only labels move to audit without hiding unknown, active or ambiguous identities',()=>{
 const missing=['(deleted) Synthetic former','Unknown','Active','Collision'];
 const ambiguous=['Ambiguous'];
 const roster=[{id:1,label:'Active'},{id:2,label:'Collision'}];
 const declarations={version:1 as const,mappings:[],sourceSets:[],historicalBillingProviders:
  ['(deleted) Synthetic former','Active','Collision','Ambiguous'].map((sourceLabel,index)=>({id:`00000000-0000-4000-8000-00000000000${index}`,sourceLabel,sourceSets:[{snapshotIds:["billing-aaaaaaaa"],start:"2026-01-01",end:"2026-01-31",complete:true as const}]}))};
 const before=JSON.stringify({missing,ambiguous,roster,declarations});
 assert.deepEqual(actionableImportLabels(missing,ambiguous,roster,[1,2],declarations),['Unknown','Active','Collision','Ambiguous']);
 assert.equal(JSON.stringify({missing,ambiguous,roster,declarations}),before);
 assert.deepEqual(actionableImportLabels(missing,ambiguous,roster,[1,2]),[...missing,...ambiguous]);
});

test('deletion text alone, conflicting registrations and stale explicit mappings remain prominent',()=>{
 const label='(deleted) Synthetic former';
 const historical={id:'00000000-0000-4000-8000-000000000001',sourceLabel:label,sourceSets:[{snapshotIds:['billing-aaaaaaaa'],start:'2026-01-01',end:'2026-01-31',complete:true as const}]};
 const declarations={version:1 as const,mappings:[],sourceSets:[],historicalBillingProviders:[historical]};
 assert.deepEqual(actionableImportLabels([label],[],[],[],{...declarations,historicalBillingProviders:[]}),[label]);
 assert.deepEqual(actionableImportLabels([label],[],[],[],{...declarations,historicalBillingProviders:[historical,historical]}),[label]);
 assert.deepEqual(actionableImportLabels([label],[],[],[],{...declarations,mappings:[{sourceLabel:label,clinicianId:99,clinicianLabel:'Missing target',teamId:null}]}),[label]);
});
