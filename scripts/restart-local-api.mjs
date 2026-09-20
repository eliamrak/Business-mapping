import {readFileSync,openSync,closeSync,writeFileSync} from "node:fs";
import {spawn,execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const database=new URL(process.env.DATABASE_URL??"");
if(!["127.0.0.1","localhost"].includes(database.hostname))throw new Error("Use an isolated local database.");
const file=path.join(root,".local/dev/processes.json"),state=JSON.parse(readFileSync(file,"utf8"));
let command="";try{command=execFileSync("ps",["-p",String(state.apiPid),"-o","command="],{encoding:"utf8"});}catch{}
if(command&&!command.includes("artifacts/api-server/dist/index.mjs"))throw new Error("Recorded PID no longer belongs to the preview API.");
if(command){process.kill(state.apiPid,"SIGTERM");await new Promise(resolve=>setTimeout(resolve,600));}
const fd=openSync(path.join(root,".local/dev/api.log"),"a");
const child=spawn(process.execPath,["artifacts/api-server/dist/index.mjs"],{cwd:root,env:{...process.env,NODE_ENV:"development",HOST:"127.0.0.1",LOCAL_PREVIEW:"true",SEED_DEMO_DATA:"false",PORT:String(state.apiPort),DATABASE_URL:database.toString()},detached:true,stdio:["ignore",fd,fd]});closeSync(fd);child.unref();
for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${state.apiPort}/api/healthz`)).ok){writeFileSync(file,JSON.stringify({...state,apiPid:child.pid},null,2));console.log(`Local API ready on ${state.apiPort} (PID ${child.pid})`);process.exit(0);}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
throw new Error("Local API failed to start. Read .local/dev/api.log.");
