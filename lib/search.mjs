import {createHash} from 'node:crypto';
import {i32,SEQUENCE_LIMIT} from './runtime.mjs';

export function searchSettings({alphabet,baseline,maxDepth,maxJobs,goal}){
  if(!Array.isArray(alphabet)||!alphabet.length||alphabet.length>5)throw Error('Choose one to five distinct i32 responses.');alphabet.forEach(i32);if(new Set(alphabet).size!==alphabet.length)throw Error('Response alphabet has duplicate values.');
  if(!Number.isInteger(maxDepth)||maxDepth<1||maxDepth>SEQUENCE_LIMIT)throw Error('Additional decision limit must be between1and32.');
  if(!Array.isArray(baseline)||baseline.length!==maxDepth||baseline.some(n=>!alphabet.includes(n)))throw Error('Baseline must provide one allowed response per additional decision.');baseline.forEach(i32);
  if(!Number.isInteger(maxJobs)||maxJobs<1||maxJobs>128)throw Error('Search supports1to128 edge attempts.');i32(goal);
  return {alphabet:[...alphabet],baseline:[...baseline],maxDepth,maxJobs,goal};
}
const MAX_EDGES=4096;
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
const fixed=s=>({alphabet:s.alphabet,baseline:s.baseline,maxDepth:s.maxDepth,goal:s.goal});
const order=(a,b)=>a.cost-b.cost||a.path.length-b.path.length||a.serial-b.serial;
const responses=n=>n.summary?.decisions?.map(d=>d.response)??n.responses??n.path??[];
function exact(x,keys){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length!==keys.length||keys.some(k=>!Object.hasOwn(x,k)))throw Error('Invalid search checkpoint fields');}
function id(value){if(typeof value!=='string'||!value.length||value.length>128||/[\x00-\x1f]/.test(value))throw Error('Invalid continuation node identifier');return value;}
function stale(message){const error=Error('Stale search checkpoint: '+message);error.code='STALE_CHECKPOINT';throw error;}

export function checkSearchCheckpoint(checkpoint){
    // Reject oversized structures before copying or canonicalizing them.
    exact(checkpoint,['schema','version','sourceIdentity','rootNodeId','settings','serial','frontier','unresolved','history','sha256']);
    if(checkpoint.schema!=='forkwake.search-checkpoint'||checkpoint.version!==1||!Array.isArray(checkpoint.history)||checkpoint.history.length>MAX_EDGES||!Array.isArray(checkpoint.frontier)||checkpoint.frontier.length>MAX_EDGES||!Array.isArray(checkpoint.unresolved)||checkpoint.unresolved.length>MAX_EDGES)throw Error('Invalid bounded search checkpoint');
    exact(checkpoint.settings,['alphabet','baseline','maxDepth','goal']);
    const saved=searchSettings({...checkpoint.settings,maxJobs:1});
    id(checkpoint.rootNodeId);if(typeof checkpoint.sourceIdentity!=='string'||!/^[a-f0-9]{64}$/.test(checkpoint.sourceIdentity))throw Error('Invalid checkpoint source identity');
    for(const entry of checkpoint.history){
      exact(entry,entry.kind==='node'?['serial','kind','nodeId','reused']:entry.kind==='error'?['serial','kind','message']:['serial','kind']);
      if(!Number.isSafeInteger(entry.serial)||entry.serial<0||entry.serial>MAX_EDGES*5||!['node','error','interrupted'].includes(entry.kind))throw Error('Invalid checkpoint attempt');
      if(entry.kind==='node'){id(entry.nodeId);if(typeof entry.reused!=='boolean')throw Error('Invalid checkpoint reuse marker');}
      if(entry.kind==='error'&&(typeof entry.message!=='string'||entry.message.length>512))throw Error('Invalid checkpoint error');
    }
    for(const edge of checkpoint.frontier){exact(edge,['nodeId','response','path','cost','serial']);id(edge.nodeId);i32(edge.response);if(!Array.isArray(edge.path)||edge.path.length<1||edge.path.length>saved.maxDepth)throw Error('Invalid checkpoint frontier path');edge.path.forEach(i32);if(!Number.isSafeInteger(edge.cost)||edge.cost<0||edge.cost>saved.maxDepth||!Number.isSafeInteger(edge.serial)||edge.serial<0||edge.serial>MAX_EDGES*5)throw Error('Invalid checkpoint frontier bounds');}
    if(checkpoint.unresolved.some(c=>!Number.isSafeInteger(c)||c<0||c>saved.maxDepth)||!Number.isSafeInteger(checkpoint.serial)||checkpoint.serial<0||checkpoint.serial>MAX_EDGES*5)throw Error('Invalid checkpoint bounds');
    const {sha256,...body}=checkpoint;if(typeof sha256!=='string'||sha256!==digest(body))throw Error('Search checkpoint digest mismatch');
    return checkpoint;
}

/** Stable across private re-sealing; the owning adapter must validate the cut. */
export function continuationIdentity(snapshot){const {seal,...state}=snapshot;return digest({policy:'forkwake.search-v1',state});}

/** Uniform-cost concrete search, with source-bound resumable scheduler state.
 * resolveNode is an owner callback for validated handles, never checkpoint code.
 */
export async function searchFutures({root,advance,settings,signal,onProgress,sourceIdentity,checkpoint,resolveNode}){
  const s=searchSettings(settings);if(root.status!=='captured')throw Error('Search starts at a paused continuation.');
  const persistent=sourceIdentity!==undefined;
  if(persistent&&(typeof sourceIdentity!=='string'||!/^[a-f0-9]{64}$/.test(sourceIdentity)))throw Error('Source identity must be a validated SHA256 cut identity');
  if(checkpoint&&!persistent)throw Error('Checkpoint resume requires its validated source identity');
  const sourceResponses=[...responses(root)];id(root.nodeId);
  const report={...s,sourceNodeId:root.nodeId,sourceResponses,executed:0,totalExecuted:0,reused:0,totalReused:0,terminals:0,matched:0,minimalWithinBounds:false,exhausted:false,depthLimited:0,failed:0,cancelled:false,budgetLimited:false,refused:false,frontier:0,errors:[],state:'unfinished',scope:'Only terminal executions from the declared starting cut, within the response alphabet and additional decision limit; change count is relative to the supplied additional-decision baseline. No claim about arbitrary responses or external effects.'};
  let serial=0;const queue=[],unresolved=[],history=[],known=new Map([[root.nodeId,root]]);
  const enqueue=(node,path,cost)=>{if(queue.length+s.alphabet.length>MAX_EDGES){report.refused=true;unresolved.push(cost);return;}for(const response of s.alphabet)queue.push({node,response,path:[...path,response],cost:cost+(response===s.baseline[path.length]?0:1),serial:serial++});};
  const take=()=>{queue.sort(order);return queue.shift();};
  const frontier=()=>[...queue].sort(order).map(({node,...edge})=>({nodeId:node.nodeId,...edge}));
  enqueue(root,[],0);
  function accept(edge,outcome,node){
    if(outcome.kind==='interrupted'){queue.push(edge);return;}
    if(outcome.kind==='error'){report.failed++;unresolved.push(edge.cost);report.errors.push({responses:edge.path,message:outcome.message});return;}
    if(persistent){
      id(node.nodeId);
      if(known.has(node.nodeId))throw Error('Duplicate continuation node identifier in search history');
      if(canonical(responses(node))!==canonical([...sourceResponses,...edge.path]))throw Error('Validated continuation history differs from the searched edge');
      known.set(node.nodeId,node);
    }
    if(outcome.reused)report.totalReused++;
    if(node.status==='completed'){
      report.terminals++;
      if(node.summary.returnI32===s.goal){report.matched++;report.witnessNodeId=node.nodeId;report.witnessResponses=edge.path;report.witnessCost=edge.cost;report.minimalWithinBounds=!unresolved.some(c=>c<edge.cost)&&!queue.some(e=>e.cost<edge.cost);}
    }else if(node.status==='captured'){
      if(edge.path.length>=s.maxDepth){report.depthLimited++;unresolved.push(edge.cost);}
      else enqueue(node,edge.path,edge.cost);
    }else{report.failed++;unresolved.push(edge.cost);report.errors.push({responses:edge.path,message:'Unexpected execution status'});}
  }
  if(checkpoint){
    checkSearchCheckpoint(checkpoint);checkpoint=structuredClone(checkpoint);
    if(checkpoint.sourceIdentity!==sourceIdentity||checkpoint.rootNodeId!==root.nodeId)stale('source or root changed');
    if(canonical(checkpoint.settings)!==canonical(fixed(s)))stale('settings changed; only invocation maxJobs may change');
    if(typeof resolveNode!=='function')throw Error('Resume requires a validated continuation node resolver');
    // Rebuild scheduler coverage from resolved outcomes, not saved lower bounds.
    for(const entry of checkpoint.history){
      if(report.matched||!queue.length)throw Error('Checkpoint continues after search termination');
      const edge=take();if(edge.serial!==entry.serial)throw Error('Checkpoint attempted edge order differs');
      const node=entry.kind==='node'?await resolveNode(entry.nodeId):undefined;
      if(entry.kind==='node'&&(!node||node.nodeId!==entry.nodeId))throw Error('Checkpoint references a missing validated node');
      accept(edge,entry,node);history.push(structuredClone(entry));
    }
    if(serial!==checkpoint.serial||canonical(frontier())!==canonical(checkpoint.frontier)||canonical(unresolved)!==canonical(checkpoint.unresolved))throw Error('Checkpoint frontier or unresolved coverage differs from reconstructed search');
  }
  while(queue.length&&!report.matched&&!report.refused){
    if(signal?.aborted){report.cancelled=true;break;}
    if(report.executed>=s.maxJobs){report.budgetLimited=true;break;}
    if(history.length>=MAX_EDGES||queue.length>MAX_EDGES){report.refused=true;break;}
    const edge=take();report.executed++;
    let node,outcome;
    try{
      node=await advance(edge.node,edge.response);
      if(signal?.aborted){report.cancelled=true;outcome={serial:edge.serial,kind:'interrupted'};}
      else outcome={serial:edge.serial,kind:'node',nodeId:node.nodeId,reused:!!node.reused};
    }catch(error){
      if(signal?.aborted){report.cancelled=true;outcome={serial:edge.serial,kind:'interrupted'};}
      else outcome={serial:edge.serial,kind:'error',message:String(error.message).slice(0,512)};
    }
    accept(edge,outcome,node);history.push(outcome);
    if(outcome.reused)report.reused++;
    if(report.cancelled)break;
    onProgress?.(structuredClone(report));
  }
  report.totalExecuted=history.length;report.frontier=queue.length;
  report.exhausted=!queue.length&&!report.failed&&!report.depthLimited&&!report.cancelled&&!report.budgetLimited&&!report.refused;
  report.state=report.matched?'matched':report.exhausted?'exhausted':report.refused?'refused':'unfinished';
  if(persistent){const body={schema:'forkwake.search-checkpoint',version:1,sourceIdentity,rootNodeId:root.nodeId,settings:fixed(s),serial,frontier:frontier(),unresolved:[...unresolved],history};report.checkpoint={...body,sha256:digest(body)};}
  return report;
}
