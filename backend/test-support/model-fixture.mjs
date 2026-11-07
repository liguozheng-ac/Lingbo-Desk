import { workerData, parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
const originalFetch=globalThis.fetch;
let round=0;
const reportRounds={extract:0,report:0};
globalThis.fetch=async (input,options)=>{
 const url=new URL(typeof input==='string'?input:input.url);
 if(url.hostname!=='api.deepseek.com')return originalFetch(input,options);
 const actions=workerData.mode==='report'?[
  {name:'read_file',arguments:JSON.stringify({path:'source-a.md'})},
  {name:'read_file',arguments:JSON.stringify({path:'source-b.md'})},
  {name:'write_file',arguments:JSON.stringify({path:'extract.md',content:'# 资料提取\n产品是 Windows 桌面语音助手，支持中日英交流。'})},
  null,
  {name:'read_file',arguments:JSON.stringify({path:'extract.md'})},
  {name:'write_file',arguments:JSON.stringify({path:'report.md',content:'# 产品定位\nWindows 桌面语音助手。\n## 核心需求\n语音与后台工作。\n## 后续验证\n验证执行证据。'})},
  null,
 ]:[
  {name:'work_write',arguments:JSON.stringify({path:'source-proof.md',content:'# Source repository\nActual isolated worker and file executor passed.\n'})},
  {name:'work_finish',arguments:JSON.stringify({outcome:'complete',summary:'Created and verified source-proof.md.'})},
 ];
 const stage=workerData.mode==='report'&&JSON.stringify(JSON.parse(options.body).messages).includes('创建全新文件 report.md')?'report':'extract';
 const action=workerData.mode==='report'?(stage==='report'?actions.slice(4):actions.slice(0,4))[reportRounds[stage]++]:actions[round++];
 const delta=action?{role:'assistant',tool_calls:[{index:0,id:'fixture-'+round,type:'function',function:action}]}:{role:'assistant',content:'Verified.'};
 const chunks=[{choices:[{index:0,delta,finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:action?'tool_calls':'stop'}]}];
 const body=chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n';
 return new Response(body,{headers:{'Content-Type':'text/event-stream'}});
};
await import(pathToFileURL(workerData.entry));
parentPort.postMessage({ready:true});
