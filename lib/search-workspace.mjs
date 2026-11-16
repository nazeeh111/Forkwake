/** Portable search owns only search state; execution stays in executeJob. */
import {createHash,randomBytes} from 'node:crypto';
import {executeJob} from './jobs.mjs';
import {searchFutures,searchSettings,continuationIdentity,checkSearchCheckpoint} from './search.mjs';
import {reportFromMemory} from './fixture.mjs';
import {reportFulfillmentFromMemory} from './fulfillment-fixture.mjs';
import {scriptReportFromMemory} from './script-fixture.mjs';
const MAX_BYTES=96*1024*1024,MAX_MEMORY=128*1024*1024,MAX_NODES=64;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw Error('Invalid search workspace fields');}
function normalized(node){const copy=structuredClone(node);delete copy.summary.importReexecutedPrefix;delete copy.summary.importReexecutedDecisions;if(copy.summary.status==='imported')copy.summary.status='captured';return copy;}
export function nodeFromResult(result,{nodeId,parentId=null,response=null,additionalResponses=[]},digest,moduleBytes){
 const memory=result.snapshot?.memoryBase64??result.finalMemoryBase64;
 const report=scriptReportFromMemory(moduleBytes,memory)??reportFulfillmentFromMemory(digest,memory)??reportFromMemory(digest,memory);
 if(report?.kind==='javascript'&&report.status==='error')throw Error(`JavaScript workflow failed: ${String(report.diagnostic||'guest script error').slice(0,2048)}`);
 return {nodeId,parentId,response,additionalResponses:[...additionalResponses],responses:result.summary.decisions.map(d=>d.response),status:result.snapshot?'captured':'completed',summary:result.summary,...(report?{report}:{})};
}
export function encodeSearchWorkspace(value){const text=JSON.stringify(value);if(Buffer.byteLength(text)>MAX_BYTES)throw Error('Search checkpoint exceeds 96MiB');return text+'\n';}
export function checkSearchWorkspace(value){
 exact(value,['schema','version','workspace','nodes','checkpoint','sha256']);
 checkSearchCheckpoint(value.checkpoint);
 if(value.schema!=='forkwake.search-workspace'||value.version!==1||!Array.isArray(value.nodes)||!value.nodes.length||value.nodes.length>MAX_NODES)throw Error('Invalid bounded portable search workspace');
 const {sha256,...body}=value;if(typeof sha256!=='string'||sha256!==sha(encodeSearchWorkspace(body)))throw Error('Search workspace digest mismatch');
 const w=value.workspace;exact(w,['schema','version','module','snapshot','settings','branches']);exact(w.module,['name','sha256','dataBase64']);exact(w.settings,['entry','args']);
 if(w.schema!=='forkwake.workspace'||w.version!==2||!Array.isArray(w.branches)||w.branches.length||w.settings.entry!=='run'||!same(w.settings.args,w.snapshot?.args)||w.snapshot.entry!==w.settings.entry)throw Error('Invalid root workspace settings');
 return value;
}

/** Restart validation reconstructs retained handles; new attempts have own budget. */
export async function searchWorkspace({bytes,name,input,settings,prior,signal,onProgress,onCapture}){
 bytes=Buffer.from(bytes);if(!bytes.length||bytes.length>8*1024*1024||typeof name!=='string'||!name.length||name.length>256)throw Error('Invalid bounded search module');
 settings=searchSettings(settings);const digest=sha(bytes),moduleBase64=bytes.toString('base64');
 if(prior){
  checkSearchWorkspace(prior);
  if(input!==undefined&&!same([input],prior.workspace.settings.args))throw Error('Stale search workspace entry arguments');
  if(prior.workspace.module.sha256!==digest||prior.workspace.module.dataBase64!==moduleBase64)throw Error('Stale search workspace module identity');
  prior=structuredClone(prior);
 }
 const snapshotKey=randomBytes(32).toString('hex');let prepared,validationJobs=0,newWorkerJobs=0;
 async function execute(request,validation=false){
  if(validation)validationJobs++;else newWorkerJobs++;
  const result=await executeJob(request,{snapshotKey,trustedPrepared:prepared,signal});
  if(result.internalPrepared)prepared=result.internalPrepared;
  return result;
 }
 const captured=await execute(prior?{operation:'sequence-import',moduleBase64,snapshot:prior.workspace.snapshot}:{operation:'sequence-capture',moduleBase64,entry:'run',args:[input]},!!prior);
 const root=normalized(nodeFromResult(captured,{nodeId:'n0'},digest,bytes));
 const workspace={schema:'forkwake.workspace',version:2,module:{name,sha256:digest,dataBase64:moduleBase64},snapshot:captured.snapshot,settings:{entry:'run',args:captured.snapshot.args},branches:[]};
 const sourceIdentity=continuationIdentity(captured.snapshot);
 await onCapture?.(structuredClone(workspace));
 const nodes=[root],snapshots=new Map([['n0',captured.snapshot]]),remaining=new Map(),known=new Map([['n0',root]]);
 let retainedBytes=captured.summary.memoryBytes,peakRetainedBytes=retainedBytes;
 const release=id=>{const snapshot=snapshots.get(id);if(snapshot){if(id!=='n0')retainedBytes-=Buffer.byteLength(snapshot.memoryBase64,'base64');snapshots.delete(id);}};
 const retain=(node,snapshot)=>{
  if(retainedBytes+Buffer.byteLength(snapshot.memoryBase64,'base64')>MAX_MEMORY)throw Error('Search exceeds 128MiB retained continuation memory');
  snapshots.set(node.nodeId,snapshot);retainedBytes+=Buffer.byteLength(snapshot.memoryBase64,'base64');peakRetainedBytes=Math.max(peakRetainedBytes,retainedBytes);
 };
 if(retainedBytes>MAX_MEMORY)throw Error('Root exceeds retained continuation memory');
 if(prior){
  if(!same(root,normalized(prior.nodes[0])))throw Error('Search root metadata differs from validated cut');
  for(const node of prior.nodes.slice(1))remaining.set(node.parentId,(remaining.get(node.parentId)??0)+1);
  if(!Array.isArray(prior.checkpoint?.frontier))throw Error('Invalid checkpoint frontier');
  for(const edge of prior.checkpoint.frontier)remaining.set(edge.nodeId,(remaining.get(edge.nodeId)??0)+1);
  for(let index=1;index<prior.nodes.length;index++){
   const saved=prior.nodes[index];if(saved.nodeId!==`n${index}`||!known.has(saved.parentId))throw Error('Invalid ordered continuation graph');
   const parent=snapshots.get(saved.parentId);if(!parent)throw Error('Missing validated graph parent');
   const result=await execute({operation:'sequence-advance',moduleBase64,snapshot:parent,response:saved.response},true);
   const node=nodeFromResult(result,{nodeId:saved.nodeId,parentId:saved.parentId,response:saved.response,additionalResponses:[...known.get(saved.parentId).additionalResponses,saved.response]},digest,bytes);
   if(!same(node,saved))throw Error('Search node differs from independently reconstructed outcome');
   remaining.set(saved.parentId,remaining.get(saved.parentId)-1);if(remaining.get(saved.parentId)===0)release(saved.parentId);
   if(result.snapshot&&(remaining.get(node.nodeId)??0)>0)retain(node,result.snapshot);
   nodes.push(node);known.set(node.nodeId,node);
  }
 }else remaining.set('n0',settings.alphabet.length);
 const search=await searchFutures({root,settings,sourceIdentity,checkpoint:prior?.checkpoint,resolveNode:id=>known.get(id),signal,onProgress,
  advance:async(parent,response)=>{
   if(nodes.length>=MAX_NODES)throw Error('The64-node retention limit prevents this edge; coverage remains incomplete');
   const snapshot=snapshots.get(parent.nodeId);if(!snapshot)throw Error('Paused parent continuation is no longer retained');
   try{
    const result=await execute({operation:'sequence-advance',moduleBase64,snapshot,response});
    if(signal?.aborted)throw Error('Interrupted before accepting outcome');
    const node=nodeFromResult(result,{nodeId:`n${nodes.length}`,parentId:parent.nodeId,response,additionalResponses:[...parent.additionalResponses,response]},digest,bytes);
    if(result.snapshot&&node.additionalResponses.length<settings.maxDepth){
     if(remaining.get(parent.nodeId)===1)release(parent.nodeId);
     retain(node,result.snapshot);remaining.set(node.nodeId,settings.alphabet.length);
    }
    nodes.push(node);known.set(node.nodeId,node);return node;
   }finally{if(!signal?.aborted){remaining.set(parent.nodeId,remaining.get(parent.nodeId)-1);if(remaining.get(parent.nodeId)===0)release(parent.nodeId);}}
  }});
 const body={schema:'forkwake.search-workspace',version:1,workspace,nodes,checkpoint:search.checkpoint};
 const checkpoint={...body,sha256:sha(encodeSearchWorkspace(body))};encodeSearchWorkspace(checkpoint);
 return {workspace,nodes,search,checkpoint,actual:{validationJobs,newWorkerJobs,workerJobs:validationJobs+newWorkerJobs,nodeRecords:nodes.length,peakRetainedGuestMemoryBytes:peakRetainedBytes,retainedPausedCuts:snapshots.size}};
}
