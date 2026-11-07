import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'lingbo-source-task-'));
const worker=new Worker(new URL('../backend/test-support/model-fixture.mjs',import.meta.url),{workerData:{entry:path.join(root,'backend/server.mjs')},env:{...process.env,VOICE_AGENT_WORKSPACE:workspace,LINGBO_GATEWAY_PORT:'3855',DEEPSEEK_API_KEY:'synthetic-local-fixture-only'}});
const result={scope:'Real gateway, agent worker and file executor with deterministic model responses. No cloud requests.',passed:false};
let failure;
worker.on('error',e=>{failure=e});
try{
 const origin='http://127.0.0.1:3855';let bootstrap;
 for(let i=0;i<80;i++){if(failure)throw failure;try{bootstrap=await fetch(origin+'/bootstrap').then(r=>r.json());break}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(bootstrap?.token,'Gateway did not start');
 const headers={Authorization:'Bearer '+bootstrap.token,'Content-Type':'application/json','X-Lingbo-Session':'source-fixture','X-Request-ID':'source-fixture-1'};
 const response=await fetch(origin+'/work/submit',{method:'POST',headers,body:JSON.stringify({request:'Create source-proof.md in the task output folder and verify completion.',acceptance:[{path:'source-proof.md',contains:['Actual isolated worker'],notContains:['placeholder']} ]})});
 assert.equal(response.status,200);const value=await response.json();const id=value.task.id;let task;
 for(let i=0;i<120;i++){const state=await fetch(origin+'/work/status',{headers}).then(r=>r.json());task=state.jobs.find(j=>j.id===id);if(['completed','failed','interrupted','paused'].includes(task?.status))break;await new Promise(r=>setTimeout(r,250));}
 assert.equal(task?.status,'completed',JSON.stringify({status:task?.status,error:task?.error,result:task?.result}));
 assert.match(fs.readFileSync(path.join(task.output,'source-proof.md'),'utf8'),/Actual isolated worker/);
 assert.ok(task.receipts.some(r=>r.tool==='work_write'&&r.ok));
 assert.equal(task.verification.scope,'declared_outputs');assert.equal(task.verification.checks[0].contentChecked,true);
 assert.equal(task.toolCalls,2);
 Object.assign(result,{passed:true,taskStatus:task.status,receipts:task.receipts.map(r=>({tool:r.tool,ok:r.ok})),fileVerified:true,verificationScope:task.verification.scope,contentChecked:true,toolCalls:task.toolCalls});
}catch(error){result.error=error.message;process.exitCode=1;}
finally{await worker.terminate();console.log(JSON.stringify(result,null,2));}
