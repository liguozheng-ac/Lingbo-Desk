import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import crypto from 'node:crypto';import { fileURLToPath } from 'node:url';
import {startManagedProcess} from '../../runtime/worker-process.mjs';import {workerEnvironment} from '../../runtime/worker-environment.mjs';
test('real gateway forwards fresh own-session task context and preserves paused state and confirmation gates', {timeout:20000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lingbo-context-')),id='work-'+crypto.randomUUID(),dir=path.join(root,'.local/work-tasks',id);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'task.json'),JSON.stringify({schema:1,id,sessionId:'owner',key:'fixture',status:'paused',version:1,modelProfile:'deepseek',request:'比较两份报价并生成报告',rootIds:[],skillVersions:[],receipts:[],attempts:1,inputSources:[{source:'S1',name:'报价.md',snapshotPath:'inputs/S1.md',originalSha256:'a'.repeat(64),snapshotSha256:'b'.repeat(64)}]}));
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const managed=startManagedProcess(process.execPath,[fileURLToPath(new URL('../test-support/work-context-gateway.mjs',import.meta.url))],{cwd:root,diagnosticsDirectory:path.join(root,'diagnostics'),env:{...workerEnvironment(),VOICE_AGENT_WORKSPACE:root,LINGBO_GATEWAY_PORT:String(port),DEEPSEEK_API_KEY:'synthetic-context-fixture-only'}});
  t.after(async()=>{await managed.stop();fs.rmSync(root,{recursive:true,force:true})});const origin='http://127.0.0.1:'+port;let ready=false;for(let i=0;i<150;i++){try{ready=(await fetch(origin+'/bootstrap')).ok}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50))}assert(ready);
  const token=fs.readFileSync(path.join(root,'.local/gateway-token'),'utf8').trim();
  const post=async(route,body,owner='owner')=>{const r=await fetch(origin+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Lingbo-Session':owner},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json()};
  const query=async owner=>JSON.parse((await post('/v1/chat/completions',{messages:[{role:'user',content:'什么工作任务'}],stream:false,tools:[{type:'function',function:{name:'lingbo_work_control',parameters:{type:'object'}}}]},owner)).choices[0].message.content);
  let echo=await query('owner');assert(echo.system.join('\n').includes(id));assert(echo.system.join('\n').includes('报价.md'));assert.equal(echo.tools[0].function.name,'lingbo_work_control');
  const other=await query('other');assert(!other.system.join('\n').includes(id));assert(!other.system.join('\n').includes('报价.md'));
  const updated=await post('/work/control',{taskId:id,action:'modify',version:1,request:'把清单移到报告开头'});assert.equal(updated.task.version,2);assert.equal(updated.task.status,'paused');
  echo=await query('owner');assert(echo.system.join('\n').includes('"version":2'));assert(echo.system.join('\n').includes('把清单移到报告开头'));
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'task.json'),'utf8'));assert.equal(saved.status,'paused');assert.deepEqual(saved.receipts,[]);assert.equal(saved.attempts,1);assert(!saved.approval);
});
