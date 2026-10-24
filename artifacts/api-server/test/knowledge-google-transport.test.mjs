import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../package.json',import.meta.url)),{build}=require('esbuild');
const built=await build({stdin:{contents:"export * from './knowledge/google-transport';export * from './knowledge/google-read-adapter';",loader:'ts',resolveDir:fileURLToPath(new URL('../src/',import.meta.url))},bundle:true,write:false,format:'cjs',platform:'node',packages:'external'});const module={exports:{}};new Function('module','exports','require',built.outputFiles[0].text)(module,module.exports,require);
const {createGoogleDriveTransport,GOOGLE_DRIVE_READ_SCOPE,DRIVE_METADATA_FIELDS,googleProductionSetupState,createGoogleReadAdapter}=module.exports;
function fixture(kind='map-json'){
 const file={fileId:'synthetic_file',parentId:'synthetic_folder',sourceOwnerId:'synthetic_owner',readerPrincipalId:'synthetic_reader',approvedForImport:true,kind,driveVersion:'1',rawHash:'a'.repeat(64),masterHash:'b'.repeat(64),maxBytes:1000};
 if(kind==='google-doc')file.documentEnvelope={practiceId:'synthetic_practice',principalId:'synthetic_principal',schemaVersion:1,resourceId:'40000000-0000-4000-8000-000000000001',version:1,title:'Synthetic',category:'operations',audience:'owner',approval:'draft',approvedBy:null,approvedAt:null};
 const config={enabled:true,expectedServiceAccountEmail:'synthetic-reader@synthetic-project.iam.gserviceaccount.com',expectedReaderPermissionId:'synthetic_reader',scope:GOOGLE_DRIVE_READ_SCOPE,permissionMaxAgeMs:1000,timeoutMs:1000,registration:{enabled:true,files:[file]}};
 const f={config,file,calls:[],tokenCalls:0};f.token={accessToken:'synthetic-not-a-credential',serviceAccountEmail:config.expectedServiceAccountEmail,scope:GOOGLE_DRIVE_READ_SCOPE,expiresAtMs:100000};
 f.tokens={getToken:async request=>{f.tokenCalls++;assert.equal(request.serviceAccountEmail,config.expectedServiceAccountEmail);assert.equal(request.scope,GOOGLE_DRIVE_READ_SCOPE);return f.token}};
 f.respond=async()=>new Response('{}',{headers:{'content-type':'application/json'}});
 f.http=async(url,init)=>{f.calls.push({url,init});return f.respond(url,init)};
 f.client=()=>createGoogleDriveTransport(f.config,f.tokens,f.http,()=>0);return f;
}
test('production and disabled configuration cannot construct requests, tokens or ambient credentials',async()=>{
 assert.equal(googleProductionSetupState({GOOGLE_APPLICATION_CREDENTIALS:'/not-used',PRACTICE_KNOWLEDGE_GOOGLE_ENABLED:'false'}).enabled,false);assert.throws(()=>googleProductionSetupState({PRACTICE_KNOWLEDGE_GOOGLE_ENABLED:'true'}),/Google source read failed/);
 for(const change of [f=>f.config.enabled=false,f=>f.config.registration.enabled=false,f=>f.file.approvedForImport=false]){const f=fixture();change(f);await assert.rejects(f.client().metadata(f.file.fileId,DRIVE_METADATA_FIELDS));assert.equal(f.tokenCalls,0);assert.equal(f.calls.length,0);}
 const f=fixture();await assert.rejects(f.client().metadata('https://unapproved.test',DRIVE_METADATA_FIELDS));assert.equal(f.tokenCalls,0);
});
test('fixed Drive metadata/media/export GETs never follow URLs or send credentials outside headers',async()=>{
 const f=fixture(),client=f.client();await client.metadata(f.file.fileId,DRIVE_METADATA_FIELDS);for await(const _ of await client.downloadJson(f.file.fileId,1000)){}
 assert.equal(new URL(f.calls[0].url).origin,'https://www.googleapis.com');assert.equal(new URL(f.calls[0].url).pathname,'/drive/v3/files/synthetic_file');assert.equal(new URL(f.calls[0].url).searchParams.get('fields'),DRIVE_METADATA_FIELDS);assert.equal(new URL(f.calls[1].url).searchParams.get('alt'),'media');
 for(const {url,init} of f.calls){assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.headers.Authorization,'Bearer synthetic-not-a-credential');assert.ok(!url.includes('credential'));assert.equal(init.body,undefined);}
 const d=fixture('google-doc');d.respond=async()=>new Response('Synthetic prose',{headers:{'content-type':'text/plain; charset=UTF-8'}});for await(const _ of await d.client().exportText(d.file.fileId,'text/plain',1000)){}assert.equal(new URL(d.calls[0].url).pathname,'/drive/v3/files/synthetic_file/export');assert.equal(new URL(d.calls[0].url).searchParams.get('mimeType'),'text/plain');
});
test('token identity, scope, expiry and header injection are rejected before HTTP',async()=>{
 for(const patch of [{serviceAccountEmail:'owner@example.test'},{scope:'https://www.googleapis.com/auth/drive'},{expiresAtMs:0},{accessToken:'bad\r\nHeader: yes'}]){const f=fixture();Object.assign(f.token,patch);await assert.rejects(f.client().metadata(f.file.fileId,DRIVE_METADATA_FIELDS));assert.equal(f.calls.length,0);}
 const f=fixture();f.config.scope='https://www.googleapis.com/auth/drive';assert.throws(()=>f.client());
});
test('redirects, unsupported MIME and oversized declared/streamed content fail safely',async()=>{
 for(const response of [()=>new Response('',{status:302,headers:{location:'https://unapproved.test'}}),()=>new Response('<html/>',{headers:{'content-type':'text/html'}}),()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'1000000'}}),()=>new Response('x'.repeat(1001),{headers:{'content-type':'application/json'}})]){const f=fixture();f.respond=response;await assert.rejects(f.client().downloadJson(f.file.fileId,1000));assert.equal(f.calls.length,1);}
});
test('timeouts cover token issuance, HTTP and body consumption with cancellation',async()=>{
 for(const part of ['token','http','body']){const f=fixture();f.config.timeoutMs=10;if(part==='token')f.tokens.getToken=async()=>new Promise(()=>{});if(part==='http')f.respond=async()=>new Promise(()=>{});if(part==='body')f.respond=async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{})}}),{headers:{'content-type':'application/json'}});await assert.rejects(f.client().metadata(f.file.fileId,DRIVE_METADATA_FIELDS),e=>e.status===503);if(f.calls.length)assert.equal(f.calls[0].init.signal.aborted,true);}
});
test('credential-bearing upstream errors/bodies and invalid configuration never escape',async()=>{
 const sentinel='DO_NOT_EXPOSE_SYNTHETIC_SENTINEL';
 for(const part of ['token','http','provider','config']){const f=fixture();if(part==='token')f.tokens.getToken=async()=>{throw Error(sentinel)};if(part==='http')f.respond=async()=>{throw Error(sentinel)};if(part==='provider')f.respond=async()=>new Response(JSON.stringify({error:{message:sentinel,errors:[{reason:'rateLimitExceeded',message:sentinel}]}}),{status:403,headers:{'content-type':'application/json'}});if(part==='config')f.config.private_key=sentinel;try{await f.client().metadata(f.file.fileId,DRIVE_METADATA_FIELDS);assert.fail('must reject')}catch(error){assert.ok(!String(error).includes(sentinel));assert.ok(!JSON.stringify(error).includes(sentinel));if(part==='provider')assert.equal(error.reason,'rateLimitExceeded');}}
});
test('concrete transport does not claim restricted ACL authority or weaken the conservative adapter gate',async()=>{
 const f=fixture(),client=f.client();assert.equal((await client.authority(f.file.fileId)).status,'unknown');const adapter=createGoogleReadAdapter(()=>f.config.registration,async()=>client);assert.equal((await adapter.readFile(f.file.fileId)).status,'unapproved');assert.equal(f.tokenCalls,0);assert.equal(f.calls.length,0);
});
