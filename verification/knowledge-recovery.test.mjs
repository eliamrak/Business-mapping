import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createNativePostgresFixture,sanitizeNativeParentEnvironment} from './native-postgres-fixture.mjs';
const run=promisify(execFile),require=createRequire(new URL('../lib/db/package.json',import.meta.url));
const apiRequire=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {Pool}=require('pg'),{drizzle}=require('drizzle-orm/node-postgres'),{build}=apiRequire('esbuild');
sanitizeNativeParentEnvironment();
async function compile(file,resolver=apiRequire){const result=await build({entryPoints:[new URL(file,import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});const module={exports:{}};new Function('module','exports','require',result.outputFiles[0].text)(module,module.exports,resolver);return module.exports;}
const tables=['knowledge_resources','knowledge_versions','knowledge_import_receipts','knowledge_source_authorizations','knowledge_pipeline_states'];
const scope={practiceId:'synthetic_recovery',principalId:'synthetic_owner'},context={role:'owner',principalId:scope.principalId},at='2026-01-01T00:00:00Z';
const id='20000000-0000-4000-8000-000000000001';
test('authoritative runtime publishes transactionally and all five Knowledge tables recover in isolated PostgreSQL', {skip:!process.env.PRACTICE_NATIVE_POSTGRES_BIN},async()=>{
 const source=createNativePostgresFixture({directory:'/tmp/knowledge-source-'+randomUUID()});
 const restored=createNativePostgresFixture({directory:'/tmp/knowledge-restored-'+randomUUID()});
 const evidence=await fs.mkdtemp('/tmp/knowledge-recovery-evidence-');let a,b;
 try {
  await source.start(true);await restored.start(true);a=new Pool({connectionString:source.connectionString});b=new Pool({connectionString:restored.connectionString});
  const migration=await fs.readFile(new URL('../lib/db/migrations/20261024_knowledge_foundation.sql',import.meta.url),'utf8');await a.query(migration);await b.query(migration);
  const schema=await compile('../lib/db/src/schema/knowledge.ts');
  async function store(pool){return (await compile('../artifacts/api-server/src/knowledge/pipeline-store.ts',name=>name==='@workspace/db'?{db:drizzle(pool),...schema}:apiRequire(name))).postgresKnowledgePipelineStore;}
  const {createKnowledgeRuntime}=await compile('../artifacts/api-server/src/knowledge/runtime.ts');
  const {sourceHash}=await compile('../artifacts/api-server/src/knowledge/import-pipeline.ts');
  const {knowledgeContentHash,knowledgePublicationHash}=await compile('../artifacts/api-server/src/knowledge/service.ts');
  function fixture(version,binding=scope){
   const master={...binding,schemaVersion:1,resourceId:id,version,title:'Synthetic source with draft examples',category:'voice',audience:'owner',approval:'approved',approvedBy:binding.principalId,approvedAt:at,semantic:{kind:'document',paragraphs:['DRAFT AD EXAMPLE — Not approved for campaign use.','Fictional example version '+version]},displayText:[],links:[]};
   const bytes=JSON.stringify(master),grant={resourceId:id,fileId:'synthetic_file',parentId:'synthetic_folder',sourceOwnerId:'synthetic_author',readerPrincipalId:'synthetic_viewer',approvalEpoch:1,approvedForImport:true};
   const manifest=JSON.stringify({...binding,schemaVersion:1,bundleId:'synthetic_bundle',revision:version,audience:'owner',approval:'approved',approvedBy:binding.principalId,approvedAt:at,entries:[{resourceId:id,fileId:grant.fileId,sourceRevision:'rev_'+version,version,masterHash:sourceHash(bytes)}]});
   return {manifest,config:{practiceId:scope.practiceId,enabled:true,approvedManifestHash:sourceHash(manifest),sources:[grant]},adapter:{readFile:async fileId=>{assert.equal(fileId,grant.fileId);return {status:'available',bytes,metadata:{fileId,parentId:grant.parentId,sourceOwnerId:grant.sourceOwnerId,readerPrincipalId:grant.readerPrincipalId,permission:'viewer',visibility:'restricted',revision:'rev_'+version}}}}};
  }
  const first=fixture(1),second=fixture(2);let config=null;const sourceStore=await store(a),runtime=createKnowledgeRuntime(sourceStore,()=>config);
  assert.deepEqual(await runtime.read(scope,context),[]);assert.equal((await runtime.stage(scope,context,first.manifest,first.adapter,at)).status,'disabled');assert.equal((await a.query('SELECT * FROM knowledge_pipeline_states')).rowCount,0);
  config=first.config;
  await assert.rejects(runtime.read(scope,{...context,role:'data_entry'}));
  await assert.rejects(runtime.read(scope,{...context,principalId:'another'}));
  await assert.rejects(runtime.stage(scope,{...context,role:'data_entry'},first.manifest,first.adapter,at));
  await assert.rejects(async()=>runtime.stage(scope,{...context,principalId:'another'},first.manifest,first.adapter,at));
  await runtime.stage(scope,context,first.manifest,first.adapter,at);assert.deepEqual(await runtime.read(scope,context),[]);
  await runtime.activate(scope,context,at);const before=await runtime.read(scope,context);assert.equal(before.length,1);assert.match(before[0].content.blocks.map(x=>x.text).join('\n'),/DRAFT AD EXAMPLE.*Not approved for campaign use/);
  await runtime.stage(scope,context,first.manifest,{readFile:async()=>({status:'network-error'})},at);assert.deepEqual(await runtime.read(scope,context),[]);
  await runtime.stage(scope,context,first.manifest,first.adapter,at);assert.deepEqual(await runtime.read(scope,context),before);
  const {createKnowledgeReadRouter}=await compile('../artifacts/api-server/src/knowledge/router.ts');
  const app=apiRequire('express')();app.use((req,res,next)=>{res.locals.role=req.headers['x-synthetic-role'];res.locals.principalId=req.headers['x-synthetic-principal'];next()});app.use('/api',createKnowledgeReadRouter((binding,auth)=>runtime.read(binding,auth),()=>scope.practiceId));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {
   const url='http://127.0.0.1:'+server.address().port+'/api/knowledge';
   const headers={'x-synthetic-role':'owner','x-synthetic-principal':scope.principalId};
   const response=await fetch(url,{headers});assert.equal(response.status,200);assert.deepEqual((await response.json()).resources,before);assert.equal(response.headers.get('cache-control'),'private, no-store');
   assert.equal((await fetch(url,{headers:{...headers,'x-synthetic-role':'data_entry'}})).status,403);
   assert.equal((await fetch(url)).status,403);assert.equal((await fetch(url+'?principalId=other',{headers})).status,400);
   assert.equal((await fetch(url,{method:'POST',headers})).status,405);
   assert.deepEqual((await (await fetch(url,{headers:{...headers,'x-synthetic-principal':'other'}})).json()).resources,[]);
   config=null;assert.deepEqual((await (await fetch(url,{headers})).json()).resources,[]);config=first.config;
  }finally{await new Promise(resolve=>server.close(resolve));}
  assert.deepEqual(await runtime.read({...scope,principalId:'another'},{...context,principalId:'another'}),[]);await assert.rejects(runtime.read({...scope,practiceId:'another'},context));
  assert.equal((await runtime.stage(scope,context,first.manifest,first.adapter,at)).status,'unchanged');assert.equal((await sourceStore.read(scope)).receipts.filter(x=>x.status==='activated').length,1);
  config=second.config;await runtime.stage(scope,context,second.manifest,second.adapter,at);assert.deepEqual(await runtime.read(scope,context),[]);
  // Exercise the actual activation/store inside a transaction that subsequently fails.
  const client=await a.connect();try{await client.query('BEGIN');const txRuntime=createKnowledgeRuntime(await store(client),()=>config);await txRuntime.activate(scope,context,at);assert.equal((await txRuntime.read(scope,context))[0].version,2);assert.deepEqual(await runtime.read(scope,context),[]);await assert.rejects(client.query('SELECT 1/0'));await client.query('ROLLBACK');}finally{client.release();}
  config=first.config;assert.deepEqual(await runtime.read(scope,context),before);config=second.config;
  await runtime.activate(scope,context,at);assert.equal((await runtime.read(scope,context))[0].version,2);
  // Include every relational table in recovery, even though publication has only one authoritative state row.
  const doc=(await runtime.read(scope,context))[0];await a.query('INSERT INTO knowledge_resources(practice_id,principal_id,id,title,category,published_version) VALUES($1,$2,$3,$4,$5,2)',[scope.practiceId,scope.principalId,id,doc.title,doc.category]);
  await a.query("INSERT INTO knowledge_versions(practice_id,principal_id,resource_id,version,content,content_hash,source,title,category,publication_hash,approval,approved_by,approved_at) VALUES($1,$2,$3,2,$4,$5,$6,$7,$8,$9,'approved',$2,$10)",[scope.practiceId,scope.principalId,id,doc.content,knowledgeContentHash(doc.content),{provider:'manual',fileId:'synthetic_file',revision:'rev_2',authorizationEpoch:1,approvedForImport:true},doc.title,doc.category,knowledgePublicationHash({title:doc.title,category:doc.category,content:doc.content}),at]);
  await a.query("INSERT INTO knowledge_import_receipts VALUES($1,$2,$3,$4,'synthetic_file','rev_2',$5,'staged','validated-draft',$6)",[scope.practiceId,scope.principalId,randomUUID(),id,doc.contentHash,at]);
  await a.query("INSERT INTO knowledge_source_authorizations VALUES($1,$2,'synthetic_file',1,'revoked',NULL,NULL)",[scope.practiceId,scope.principalId]);
  // A revoked authoritative source must stay revoked after recovery, including tombstone/cache eviction/history.
  await runtime.stage(scope,context,second.manifest,{readFile:async()=>({status:'permission-denied'})},at);assert.deepEqual(await runtime.read(scope,context),[]);
  const otherScope={...scope,principalId:'synthetic_second_owner'},otherContext={role:'owner',principalId:otherScope.principalId};
  const otherFixture=fixture(1,otherScope),otherRuntime=createKnowledgeRuntime(sourceStore,()=>otherFixture.config);
  await otherRuntime.stage(otherScope,otherContext,otherFixture.manifest,otherFixture.adapter,at);await otherRuntime.activate(otherScope,otherContext,at);
  const otherBefore=await otherRuntime.read(otherScope,otherContext);assert.equal(otherBefore.length,1);
  const dump=path.join(evidence,'knowledge.sql'),bin=process.env.PRACTICE_NATIVE_POSTGRES_BIN;
  const env={PATH:process.env.PATH,LANG:'C',PGPASSFILE:'/dev/null',PGCONNECT_TIMEOUT:'5'};
  await run(path.join(bin,'pg_dump'),['--dbname',source.connectionString,'--data-only','--column-inserts','--no-owner','--no-privileges',...tables.flatMap(t=>['--table','public.'+t]),'--file',dump],{env,timeout:30000});
  // Restore failures roll back all prior inserts: no partially recovered publication.
  const bad=path.join(evidence,'invalid.sql');await fs.writeFile(bad,(await fs.readFile(dump,'utf8'))+'\nSELECT 1/0;\n');
  await assert.rejects(run(path.join(bin,'psql'),['--dbname',restored.connectionString,'--single-transaction','--set','ON_ERROR_STOP=1','--file',bad],{env,timeout:30000}));
  for(const t of tables)assert.equal((await b.query('SELECT * FROM '+t)).rowCount,0);
  await run(path.join(bin,'psql'),['--dbname',restored.connectionString,'--single-transaction','--set','ON_ERROR_STOP=1','--file',dump],{env,timeout:30000});
  const counts={};for(const t of tables){const rows=async pool=>(await pool.query('SELECT to_jsonb(t) AS value FROM '+t+' t ORDER BY to_jsonb(t)::text')).rows;assert.deepEqual(await rows(b),await rows(a));counts[t]=(await rows(b)).length;assert.ok(counts[t]>0);}
  const recoveredStore=await store(b),recovered=createKnowledgeRuntime(recoveredStore,()=>config);
  assert.deepEqual(await createKnowledgeRuntime(recoveredStore,()=>null).read(otherScope,otherContext),[]);
  const recoveredOther=createKnowledgeRuntime(recoveredStore,()=>otherFixture.config);assert.deepEqual(await recoveredOther.read(otherScope,otherContext),otherBefore);assert.deepEqual(await recoveredOther.read(scope,context),[]);
  assert.deepEqual(await recovered.read(scope,context),[]);const state=await recoveredStore.read(scope);assert.ok(state.tombstones[id]);assert.deepEqual(state.cache,{});assert.equal(Object.keys(state.masters).length,2);
  assert.equal((await recovered.stage(scope,context,second.manifest,second.adapter,at)).status,'rejected');assert.deepEqual(await recovered.read(scope,context),[]);
  const report={status:'passed',scope:'Two disposable loopback PostgreSQL clusters, synthetic data only',tables:counts,checks:['disabled runtime no database writes','owner/practice isolation','real HTTP read router with synthetic server locals: owner read, role/anonymous rejection, no caller scope or writes, disabled empty response','draft marketing examples remain explicitly labeled','whole publication activation and failed transaction rollback','idempotent replay','runtime withholds network-stale data until successful revalidation','all five table rows restored exactly','second owner approved publication remains readable after recovery without leaking revoked first-owner content','failed restore rolls back all five tables','revocation/tombstones/cache removal and immutable history survive recovery','replay cannot resurrect revoked source'],dumpSha256:sourceHash(await fs.readFile(dump,'utf8')),evidence};await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 } finally{if(a)await a.end();if(b)await b.end();await source.stop('fast',{cleanup:true});await restored.stop('fast',{cleanup:true});}
});
