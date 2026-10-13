import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {executeJob} from './jobs.mjs';
import {searchFutures,searchSettings} from './search.mjs';
import {i32,decodeBase64,SEQUENCE_LIMIT} from './runtime.mjs';
import {diffMemory} from './diff.mjs';
import {FULFILLMENT_SHA,reportFulfillmentFromMemory} from './fulfillment-fixture.mjs';
import {loadScriptModule,scriptModuleInfo,scriptReportFromMemory} from './script-fixture.mjs';
const ROOT=new URL('../',import.meta.url), MAX_STORE=256*1024*1024;
const id=()=>crypto.randomBytes(12).toString('hex'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function exact(value,fields){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||fields.some(f=>!Object.hasOwn(value,f)))throw Error('Invalid sequence request fields.');}
function boundedName(value,max,label){if(typeof value!=='string'||!value.length||value.length>max)throw Error(`Invalid ${label}.`);return value;}
function publicNode(node){return {nodeId:node.nodeId,parentId:node.parentId,response:node.response,label:node.label,path:[...node.path],depth:node.path.length,status:node.status,summary:node.summary,report:node.report};}
export async function createSequenceService({snapshotKey,deadlineMs=30000,prepareDeadlineMs=90000,lookupModule}={}){
 const modules=new Map(),sessions=new Map(),jobs=new Map();
 const bytes=await fs.readFile(new URL('examples/fulfillment/workflow.raw.wasm',ROOT));if(sha(bytes)!==FULFILLMENT_SHA)throw Error('Bundled fulfillment module identity differs.');
 function stored(){let total=0;for(const m of modules.values()){total+=m.bytes.length+(m.prepared?.bytesBase64.length??0)*3/4;}for(const s of sessions.values())for(const n of s.nodes.values())total+=n.memoryBase64.length*3/4;return total;}
 function capacity(extra){if(stored()+extra>MAX_STORE)throw Error('Sequence workspace reached its256MiB memory budget. Export a paused cut and open a fresh local server.');}
 function addModule(raw,name){const digest=sha(raw);if(modules.has(digest))return modules.get(digest);if(modules.size>=4||raw.length>8*1024*1024)throw Error('Sequence workspace supports four modules up to8MiB each.');capacity(raw.length);const m={id:digest,name:boundedName(name,256,'module name'),sha256:digest,size:raw.length,bytes:raw,script:scriptModuleInfo(raw)};modules.set(digest,m);return m;}
 const publicModule=m=>({id:m.id,name:m.name,sha256:m.sha256,size:m.size,...(m.script?{script:m.script}:{})});
 function getModule(moduleId){if(modules.has(moduleId))return modules.get(moduleId);const m=lookupModule?.(moduleId);if(!m)throw Error('Load a module first.');return addModule(m.bytes,m.name);}
 function session(sessionId){const s=sessions.get(sessionId);if(!s)throw Error('Unknown sequence session.');return s;}
 function paused(s,nodeId){const n=s.nodes.get(nodeId);if(!n||!n.snapshot)throw Error('Choose a paused node in this session.');return n;}
 function info(s,selectedNodeId=s.selectedNodeId){return {sessionId:s.id,module:publicModule(s.module),settings:{entry:s.root.snapshot.entry,args:s.root.snapshot.args},isBundledExample:s.module.id===FULFILLMENT_SHA,rootNodeId:s.root.nodeId,selectedNodeId,nodes:[...s.nodes.values()].map(publicNode),searchReport:s.searchReport};}
 function accept(s,result,parent,response,label){
  if(s.nodes.size>=64)throw Error('A sequence retains at most64 nodes. Export a paused cut and start another session.');
  const memory=result.snapshot?.memoryBase64??result.finalMemoryBase64;capacity(memory.length*3/4);
  const report=s.module.script?scriptReportFromMemory(s.module.bytes,memory):reportFulfillmentFromMemory(s.module.id,memory);
  if(report?.status==='error')throw Error('JavaScript: '+(report.diagnostic||'Guest execution failed.'));
  const node={nodeId:id(),parentId:parent?.nodeId??null,response:parent?response:null,label:label??'Paused root',path:result.summary.decisions.map(d=>d.response),status:result.snapshot?'captured':'completed',snapshot:result.snapshot,memoryBase64:memory,summary:result.summary,report,children:new Map()};
  s.nodes.set(node.nodeId,node);s.selectedNodeId=node.nodeId;return node;
 }
 async function execute(m,request,signal,job){return executeJob(request,{snapshotKey,trustedPrepared:m.prepared,deadlineMs,prepareDeadlineMs,signal,onStage:()=>{job.stage=request.operation==='sequence-advance'?'Resuming to the next effect or actual return':request.operation==='sequence-import'?'Independently reconstructing the saved decision history':'Running to the first effect';}});}
 async function advance(s,parent,response,label,signal,job){
  if(parent.children.has(response))return {...s.nodes.get(parent.children.get(response)),reused:true};
  const r=await execute(s.module,{operation:'sequence-advance',moduleBase64:s.module.bytes.toString('base64'),snapshot:parent.snapshot,response},signal,job);
  if(signal.aborted)throw Error('Cancelled');
  if(parent.children.has(response))return {...s.nodes.get(parent.children.get(response)),reused:true};
  const node=accept(s,r,parent,response,label);parent.children.set(response,node.nodeId);return node;
 }
 function launch(action){
  if([...jobs.values()].filter(j=>j.state==='running').length>=2)throw Error('Two sequence jobs are active. Cancel one or wait.');
  while(jobs.size>=24){const old=[...jobs.values()].find(j=>j.state!=='running');if(!old)throw Error('Job budget reached.');jobs.delete(old.id);}
  const controller=new AbortController(),job={id:id(),state:'running',started:Date.now(),stage:'Validating compiled code',controller};jobs.set(job.id,job);
  Promise.resolve().then(()=>action(controller.signal,job)).then(result=>{if(job.state==='running'){job.state='done';job.result=result;}},error=>{if(job.state==='running'){job.state='error';job.error=String(error.message).slice(0,2048);}});
  return {job:job.id};
 }
 function cancel(jobId){const j=jobs.get(jobId);if(!j)return undefined;if(j.state==='running'){j.state='cancelled';j.controller.abort(new Error('Cancelled'));}return {state:j.state};}
 function getJob(jobId){const j=jobs.get(jobId);if(!j)return undefined;return {state:j.state,elapsedMs:Date.now()-j.started,stage:j.stage,result:j.result,error:j.error};}
 function workspace(s,node){if(!node.snapshot)throw Error('Only a paused continuation can be exported.');return {schema:'forkwake.workspace',version:2,module:{name:s.module.name,sha256:s.module.id,dataBase64:s.module.bytes.toString('base64')},snapshot:node.snapshot,settings:{entry:node.snapshot.entry,args:node.snapshot.args},branches:[]};}
 async function get(path,url){
  if(path==='/api/sequence-script-example'){const policy=url.searchParams.get('policy')??'faulty';if(!['faulty','corrected','origin'].includes(policy))throw Error('Choose faulty, corrected or origin script policy.');return {source:await fs.readFile(new URL('examples/javascript/'+(policy==='origin'?'origin-example.js':policy==='faulty'?'workflow.js':'corrected.js'),ROOT),'utf8'),name:policy==='origin'?'checkout-origin.js':policy==='faulty'?'transfer.js':'transfer-corrected.js',...(policy==='origin'?{origin:true}:{})};}
  if(path.startsWith('/api/sequences/'))return info(session(path.split('/').at(-1)));
  if(path.startsWith('/api/sequence-workspaces/')){const s=session(path.split('/').at(-1));return workspace(s,paused(s,url.searchParams.get('node')??s.root.nodeId));}
  if(path==='/api/sequence-memory'){const s=session(url.searchParams.get('session')),n=s.nodes.get(url.searchParams.get('node'));if(!n)throw Error('Unknown sequence node.');const mem=decodeBase64(n.memoryBase64,32*1024*1024);const offset=Number(url.searchParams.get('offset')??0),length=Number(url.searchParams.get('length')??128);if(!Number.isSafeInteger(offset)||offset<0||offset>mem.length||!Number.isSafeInteger(length)||length<1||length>256)throw Error('Invalid bounded memory window.');const b=mem.subarray(offset,Math.min(offset+length,mem.length));return {offset,hex:b.toString('hex'),ascii:[...b].map(v=>v>=32&&v<=126?String.fromCharCode(v):'.').join(''),totalBytes:mem.length};}
  if(path==='/api/sequence-compare'){const s=session(url.searchParams.get('session')),a=s.nodes.get(url.searchParams.get('left')),b=s.nodes.get(url.searchParams.get('right'));if(!a||!b)throw Error('Both nodes must belong to this session.');return {diff:diffMemory(decodeBase64(a.memoryBase64,32*1024*1024),decodeBase64(b.memoryBase64,32*1024*1024)),reportChanges:a.report&&b.report?Object.keys(a.report).filter(k=>JSON.stringify(a.report[k])!==JSON.stringify(b.report[k])).map(key=>({key,left:a.report[key],right:b.report[key]})):[]};}
  return undefined;
 }
 async function post(path,value){
  if(path==='/api/sequence-script'){exact(value,Object.hasOwn(value,'origin')?['source','name','origin']:['source','name']);if(Object.hasOwn(value,'origin')&&typeof value.origin!=='boolean')throw Error('Origin tracing must be a boolean.');const script=await loadScriptModule(value.source,{name:value.name,origin:value.origin??false});return publicModule(addModule(script.bytes,script.name));}
  if(path==='/api/sequence-demo'){exact(value,[]);return publicModule(addModule(bytes,'SQLite fulfillment: reserve, authorize, retry and dispatch'));}
  if(path!=='/api/sequence-jobs')return undefined;
  if(value.operation==='capture'||value.operation==='import'){
    let m,request;
    if(sessions.size>=4)throw Error('At most four sequence sessions are retained.');
    if(value.operation==='capture'){exact(value,['operation','moduleId','entry','args']);m=getModule(value.moduleId);if(value.entry!=='run'||!Array.isArray(value.args)||value.args.length!==1)throw Error('Use run(i32) with one argument.');value.args.forEach(i32);request={operation:'sequence-capture',moduleBase64:m.bytes.toString('base64'),entry:'run',args:value.args};}
    else{
      exact(value,['operation','workspace']);const w=value.workspace;exact(w,['schema','version','module','snapshot','settings','branches']);
      if(w.schema!=='forkwake.workspace'||w.version!==2||!Array.isArray(w.branches)||w.branches.length)throw Error('Use a version2 paused-cut workspace with empty branches.');
      exact(w.module,['name','sha256','dataBase64']);exact(w.settings,['entry','args']);const raw=decodeBase64(w.module.dataBase64,8*1024*1024,'saved module');
      if(sha(raw)!==w.module.sha256||w.settings.entry!=='run'||w.snapshot?.schema!==2||JSON.stringify(w.settings.args)!==JSON.stringify(w.snapshot.args)||w.snapshot.entry!==w.settings.entry)throw Error('Saved settings, module digest or snapshot version differ.');
      m=addModule(raw,w.module.name);request={operation:'sequence-import',moduleBase64:raw.toString('base64'),snapshot:w.snapshot};
    }
    return launch(async(signal,job)=>{
      const r=await execute(m,request,signal,job);if(signal.aborted)throw Error('Cancelled');if(sessions.size>=4)throw Error('Session budget reached.');
      const cacheExtra=m.prepared?0:r.internalPrepared.bytesBase64.length*3/4;capacity(cacheExtra+(r.snapshot.memoryBase64.length*3/4));
      const s={id:id(),module:m,nodes:new Map()};const root=accept(s,r,null,null,request.operation==='sequence-import'?'Validated imported cut':'First pending effect');s.root=root;
      if(!m.prepared)m.prepared=r.internalPrepared;sessions.set(s.id,s);return info(s);
    });
  }
  if(value.operation==='advance'){
    exact(value,['operation','sessionId','nodeId','response','label']);const s=session(value.sessionId),node=paused(s,value.nodeId);i32(value.response);boundedName(value.label,64,'branch label');
    return launch(async(signal,job)=>{const child=await advance(s,node,value.response,value.label,signal,job);return info(s,child.nodeId);});
  }
  if(value.operation==='search'){
    exact(value,['operation','sessionId','nodeId','alphabet','baseline','maxDepth','maxJobs','goal']);const s=session(value.sessionId),root=paused(s,value.nodeId),settings=searchSettings(value);
    if(root.path.length+settings.maxDepth>SEQUENCE_LIMIT)throw Error('Search exceeds the32-decision engine boundary.');
    return launch(async(signal,job)=>{
      const report=await searchFutures({root,settings,signal,advance:(node,response)=>advance(s,node,response,String(response),signal,job),onProgress:r=>{job.stage=`Exploring real futures: ${r.executed} edges, ${r.terminals} returns`;}});
      s.searchReport=report;return info(s,report.witnessNodeId??s.selectedNodeId);
    });
  }
  throw Error('Unknown sequence operation.');
 }
 return {get,post,getJob,cancel,close(){for(const j of jobs.values())cancel(j.id);},stored};
}
