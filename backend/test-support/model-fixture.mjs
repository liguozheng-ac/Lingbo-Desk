import { workerData, parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
const originalFetch=globalThis.fetch;
let round=0;
globalThis.fetch=async (input,options)=>{
 const url=new URL(typeof input==='string'?input:input.url);
 if(url.hostname!=='api.deepseek.com')return originalFetch(input,options);
 const actions=[
  {name:'work_write',arguments:JSON.stringify({path:'source-proof.md',content:'# Source repository\nActual isolated worker and file executor passed.\n'})},
  {name:'work_finish',arguments:JSON.stringify({outcome:'complete',summary:'Created and verified source-proof.md.'})},
 ];
 const action=actions[round++];
 const delta=action?{role:'assistant',tool_calls:[{index:0,id:'fixture-'+round,type:'function',function:action}]}:{role:'assistant',content:'Verified.'};
 const chunks=[{choices:[{index:0,delta,finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:action?'tool_calls':'stop'}]}];
 const body=chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n';
 return new Response(body,{headers:{'Content-Type':'text/event-stream'}});
};
await import(pathToFileURL(workerData.entry));
parentPort.postMessage({ready:true});
