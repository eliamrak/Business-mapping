import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { knowledgeResourceSchema, knowledgeVersionSchema, knowledgeImportReceiptSchema, knowledgeContentSchema } from '../../../lib/practice/src/knowledge.ts';
const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = require('esbuild');
const bundle = await build({ stdin: { contents: `export * from './knowledge/service'; export * from './knowledge/router'; export {requireAccess} from './lib/auth';`, loader: 'ts', resolveDir: fileURLToPath(new URL('../src/', import.meta.url)) }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'isolated-auth', setup(builder) {
  builder.onResolve({ filter: /^@clerk\/express$/ }, () => ({path:'clerk',namespace:'fixture'}));
  builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({path:'db',namespace:'fixture'}));
  builder.onLoad({ filter: /.*/, namespace:'fixture' }, args => ({ contents: args.path === 'clerk'
    ? `export const getAuth = req => req.syntheticAuth; export const clerkClient = {users:{getUser:async()=>{throw Error('unexpected external lookup')}}};`
    : `export const hubUsersTable={email:'email'}; export const db={select:()=>({from:()=>({where:async()=>[{email:'reader@example.test',role:'data_entry',disabled:0}]})})};` }));
} }] });
const compiled={exports:{}}; new Function('module','exports','require',bundle.outputFiles[0].text)(compiled,compiled.exports,require);
const { createKnowledgeRouter, requireAccess, knowledgeScope, knowledgeContentHash, listKnowledge }=compiled.exports;
const id='10000000-0000-4000-8000-000000000001';
const scope={practiceId:'practice_test',principalId:'user_owner'};
const content={blocks:[{kind:'heading',text:'Synthetic resource'},{kind:'paragraph',text:'Fictional reference only.'}]};
function pair() { return {resource:knowledgeResourceSchema.parse({...scope,id,title:'Synthetic resource',category:'resources',publishedVersion:1}),version:knowledgeVersionSchema.parse({...scope,resourceId:id,version:1,content,contentHash:knowledgeContentHash(content),approval:'approved',approvedBy:scope.principalId,approvedAt:'2026-01-01T00:00:00Z',createdAt:'2026-01-01T00:00:00Z',source:{provider:'manual',fileId:'synthetic',revision:'one',approvedForImport:true}})}; }

test('contracts default private/draft and reject public, ownership extras, URLs and unsafe content',()=>{
  const resource=knowledgeResourceSchema.parse({...scope,id,title:'Draft',category:'operations'});
  assert.equal(resource.audience,'owner'); assert.equal(resource.publishedVersion,null);
  const draft=knowledgeVersionSchema.parse({...scope,resourceId:id,version:1,content,contentHash:knowledgeContentHash(content),createdAt:'2026-01-01T00:00:00Z',source:{provider:'manual',fileId:'synthetic',revision:'one'}});
  assert.equal(draft.source.approvedForImport,false);assert.equal(draft.approval,'draft');assert.equal(draft.approvedBy,null);
  for(const patch of [{audience:'public'},{owner:'another'},{publishedVersion:0}]) assert.equal(knowledgeResourceSchema.safeParse({...resource,...patch}).success,false);
  for(const value of ['<script>alert(1)</script>','<img src=x onerror=alert(1)>','text\u0000']) assert.equal(knowledgeContentSchema.safeParse({blocks:[{kind:'paragraph',text:value}]}).success,false);
  for(const patch of [{approval:'approved'},{source:{provider:'manual',fileId:'https://example.test/private',revision:'one'}},{contentHash:'invalid'},{url:'http://localhost/secret'}]) assert.equal(knowledgeVersionSchema.safeParse({...draft,...patch}).success,false);
  assert.equal(knowledgeContentHash(content),knowledgeContentHash(structuredClone(content)));
  assert.notEqual(knowledgeContentHash(content),knowledgeContentHash({blocks:[{kind:'paragraph',text:'Changed'}]}));
  const receipt={...scope,id,resourceId:id,sourceFileId:'synthetic',sourceRevision:'one',contentHash:knowledgeContentHash(content),status:'staged',reason:'validated-draft',receivedAt:'2026-01-01T00:00:00Z'};
  assert.equal(knowledgeImportReceiptSchema.safeParse(receipt).success,true);
  assert.equal(knowledgeImportReceiptSchema.safeParse({...receipt,status:'approved'}).success,false);
  assert.equal(knowledgeImportReceiptSchema.safeParse({...receipt,status:'rejected'}).success,false);
  assert.equal(knowledgeVersionSchema.safeParse({...draft,schemaVersion:2}).success,false);
});

test('service double-checks owner/practice, published pointer, approval, content hash and archive state',async()=>{
  for(const mutate of [row=>row.version.source.approvedForImport=false,row=>row.resource.practiceId='other',row=>row.resource.principalId='other',row=>row.version.principalId='other',row=>row.resource.publishedVersion=null,row=>row.resource.publishedVersion=2,row=>row.resource.archived=true,row=>row.version.approval='draft',row=>row.version.approvedBy='other',row=>row.version.content.blocks[1].text='Tampered',row=>row.version.resourceId='10000000-0000-4000-8000-000000000002']) {
    const row=pair();mutate(row);assert.deepEqual(await listKnowledge({readPublished:async()=>[row]},scope),[]);
  }
  const row=pair();const before=structuredClone(row);const docs=await listKnowledge({readPublished:async received=>{assert.deepEqual(received,scope);return [row];}},scope);
  assert.equal(docs.length,1);assert.equal(docs[0].version,1);assert.equal('principalId' in docs[0],false);assert.equal('source' in docs[0],false);assert.deepEqual(row,before);
  for(const role of [undefined,'data_entry','viewer','admin']) assert.throws(()=>knowledgeScope(role,'user_owner','practice_test'));
  assert.throws(()=>knowledgeScope('owner','user_owner',undefined));
});

test('HTTP boundary uses Clerk principal and server practice only; rejects roles, mutations, ownership and fetch inputs',async()=>{
  const express=require('express');const app=express();let reads=0;
  const original=process.env.EMC_OWNER_EMAIL;process.env.EMC_OWNER_EMAIL='owner@example.test';
  app.use(express.json());app.use((req,res,next)=>{const owner=req.headers['x-fixture-role']==='owner'; req.syntheticAuth=req.headers['x-fixture-role']==='anonymous'?{isAuthenticated:false}:{isAuthenticated:true,userId:owner?'user_owner':'user_reader',sessionClaims:{email:owner?'owner@example.test':'reader@example.test'}};next();});
  app.use(requireAccess);app.use(createKnowledgeRouter({readPublished:async binding=>{reads++;assert.deepEqual(binding,scope);return [pair()];}},()=>scope.practiceId));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(path,role='owner',method='GET',body)=>fetch(base+path,{method,headers:{'x-fixture-role':role,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  try {
    assert.equal((await call('/knowledge','anonymous')).status,401);
    assert.equal((await call('/knowledge','data_entry')).status,403);assert.equal(reads,0);
    const response=await call('/knowledge');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal((await response.json()).resources.length,1);
    for(const query of ['?practiceId=other','?principalId=other','?url=https://example.test','?includeDrafts=true']) assert.equal((await call('/knowledge'+query)).status,400);
    for(const method of ['POST','PUT','PATCH','DELETE']) assert.equal((await call('/knowledge','owner',method,{approval:'approved',principalId:'other'})).status,405);
    assert.equal(reads,1);
  } finally {await new Promise(resolve=>server.close(resolve)); if(original===undefined)delete process.env.EMC_OWNER_EMAIL;else process.env.EMC_OWNER_EMAIL=original;}
});

test('unconfigured store fails closed without returning backend details',async()=>{
  const router=createKnowledgeRouter({readPublished:async()=>{throw new Error('private database diagnostic');}},()=>scope.practiceId);
  const handler=router.stack[0].route.stack[0].handle;
  const res={locals:{role:'owner',principalId:scope.principalId},statusCode:200,setHeader(){return this},status(n){this.statusCode=n;return this},json(body){this.body=body;return this}};
  await handler({method:'GET',query:{}},res);assert.equal(res.statusCode,503);assert.deepEqual(res.body,{code:'KNOWLEDGE_UNAVAILABLE'});
});
