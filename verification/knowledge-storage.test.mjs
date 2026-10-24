import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createNativePostgresFixture,sanitizeNativeParentEnvironment} from './native-postgres-fixture.mjs';
const require=createRequire(new URL('../lib/db/package.json',import.meta.url));
const {Pool}=require('pg');
const apiRequire=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {build}=apiRequire('esbuild');
async function compiled(file,resolveRequire=apiRequire){const result=await build({entryPoints:[new URL(file,import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});const module={exports:{}};new Function('module','exports','require',result.outputFiles[0].text)(module,module.exports,resolveRequire);return module.exports;}
// Never read or connect to an inherited application DATABASE_URL.
sanitizeNativeParentEnvironment();
test('Knowledge additive migration: scoped FKs, immutable publication, concurrent CAS and rollback', {skip:!process.env.PRACTICE_NATIVE_POSTGRES_BIN},async()=>{
 const fixture=createNativePostgresFixture({directory:'/tmp/knowledge-db-'+randomUUID()});
 let pool;
 try {
  await fixture.start(true); pool=new Pool({connectionString:fixture.connectionString});
  await pool.query(await fs.readFile(new URL('../lib/db/migrations/20261024_knowledge_foundation.sql',import.meta.url),'utf8'));
  const id='10000000-0000-4000-8000-000000000001';
  await pool.query("INSERT INTO knowledge_resources(practice_id,principal_id,id,title,category) VALUES('synthetic_p','synthetic_a',$1,'Fixture','resources')",[id]);
  const insert=`INSERT INTO knowledge_versions(practice_id,principal_id,resource_id,version,content,content_hash,source,title,category,publication_hash,approval,approved_by,approved_at) VALUES($1,$2,$3,1,'{}',$4,'{}','Fixture','resources',$4,'approved',$2,now())`;
  for(const [p,u] of [['other_p','synthetic_a'],['synthetic_p','other_user']]) await assert.rejects(pool.query(insert,[p,u,id,'a'.repeat(64)]),e=>e.code==='23503');
  await pool.query(insert,['synthetic_p','synthetic_a',id,'a'.repeat(64)]);
  await assert.rejects(pool.query("UPDATE knowledge_versions SET title='Changed draft'"),/immutable/);
  await assert.rejects(pool.query('DELETE FROM knowledge_versions'),/immutable/);
  for(const [p,u] of [['other_p','synthetic_a'],['synthetic_p','other_user']]) await assert.rejects(pool.query("INSERT INTO knowledge_import_receipts VALUES($1,$2,$3,$4,'synthetic_file','rev',$5,'staged','fixture',now())",[p,u,randomUUID(),id,'a'.repeat(64)]),e=>e.code==='23503');
  const schema=await compiled('../lib/db/src/schema/knowledge.ts');
  const {drizzle}=require('drizzle-orm/node-postgres');
  const database=drizzle(pool);
  const {postgresKnowledgePipelineStore:store}=await compiled('../artifacts/api-server/src/knowledge/pipeline-store.ts',name=>name==='@workspace/db'?{db:database,...schema}:apiRequire(name));
  const scope={practiceId:'synthetic_p',principalId:'synthetic_a'};
  const state={...scope,generation:1,active:{one:'before',two:'before'},cache:{one:'before',two:'before'}};
  assert.deepEqual((await Promise.all([store.compareAndSwap(scope,0,state),store.compareAndSwap(scope,0,state)])).sort(),[false,true]);
  const next={...state,generation:2,active:{one:'after',two:'after'},cache:{one:'after',two:'after'}};
  assert.deepEqual((await Promise.all([store.compareAndSwap(scope,1,next),store.compareAndSwap(scope,1,next)])).sort(),[false,true]);
  assert.deepEqual(await store.read(scope),next);
  assert.equal(await store.read({...scope,principalId:'other_user'}),null);
  await assert.rejects(store.compareAndSwap(scope,2,{...next,generation:3,principalId:'other_user'}),/Invalid Knowledge state transition/);
  assert.deepEqual((await pool.query('SELECT state FROM knowledge_pipeline_states')).rows[0].state,next);
  await assert.rejects(pool.query("UPDATE knowledge_pipeline_states SET state=$1",[{...next,principalId:'other_user'}]),e=>e.code==='23514');
  const client=await pool.connect();
  try {await client.query('BEGIN');await client.query('UPDATE knowledge_pipeline_states SET generation=3,state=$1',[{...next,generation:3,active:{},cache:{}}]);await assert.rejects(client.query('SELECT 1/0'));await client.query('ROLLBACK');}finally{client.release();}
  assert.deepEqual((await pool.query('SELECT state FROM knowledge_pipeline_states')).rows[0].state,next);
  assert.equal((await pool.query("SELECT * FROM knowledge_pipeline_states WHERE principal_id='other_user'")).rowCount,0);
 } finally {if(pool)await pool.end();await fixture.stop('fast',{cleanup:true});}
});
