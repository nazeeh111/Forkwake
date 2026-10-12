import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {instrument,sha256,LIMITS,VALIDATION_POLICY} from './transform.mjs';
import {diffMemory,diffGlobals} from './diff.mjs';

const sessionKey=randomBytes(32);
let lastPrepared;
const SNAPSHOT_KEYS=['schema','moduleSha256','instrumentedSha256','entry','args','memoryBase64','memorySha256','globals','bridge','continuation','seal'];
const u32=n=>n>>>0;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
function exact(object,keys,label){if(!plain(object)||Object.keys(object).length!==keys.length||keys.some(k=>!Object.hasOwn(object,k)))throw Error(`Invalid ${label} shape`);}
function integer(n,lo,hi,label){if(!Number.isInteger(n)||n<lo||n>hi)throw Error(`Invalid ${label}`);return n;}
export function i32(n){return integer(n,-2147483648,2147483647,'i32 value');}
function hex(value,label){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw Error(`Invalid ${label}`);}
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(plain(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function keyBytes(value){if(value===undefined)return sessionKey;if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw Error('Trusted snapshot key must be 32-byte hex');return Buffer.from(value,'hex');}
function content(snapshot){const {seal,...body}=snapshot;return body;}
function seal(snapshot,key){return createHmac('sha256',key).update(canonical(content(snapshot))).digest('hex');}
export function decodeBase64(value,maximum,label='base64'){
  // Avoid repeating-group regexes: V8's regexp stack can overflow on full-memory snapshots.
  if(typeof value!=='string'||value.length>Math.ceil(maximum/3)*4||value.length%4||! /^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error(`Invalid ${label}`);
  const bytes=Buffer.from(value,'base64');if(bytes.length>maximum||bytes.toString('base64')!==value)throw Error(`Invalid ${label}`);return bytes;
}
function bridgeShape(bridge,sequence=false){
  exact(bridge,['prefix','suffix','pending','sealed','ownedCounter'],'bridge');
  if(!Array.isArray(bridge.prefix)||!Array.isArray(bridge.suffix)||bridge.prefix.length+bridge.suffix.length>LIMITS.events||(!sequence&&bridge.suffix.length!==0)||bridge.sealed!==true||bridge.ownedCounter!==bridge.prefix.length)throw Error('Invalid captured bridge history');
  for(const event of [...bridge.prefix,...bridge.suffix]){exact(event,['stage','value'],'trace event');integer(event.stage,0,0xffffffff,'stage');integer(event.value,0,0xffffffff,'trace value');}
  if(!Array.isArray(bridge.pending)||bridge.pending.length!==4)throw Error('Invalid pending effect');bridge.pending.forEach(n=>integer(n,0,0xffffffff,'pending argument'));
}
function validateSnapshot(snapshot,key,authenticate=true,sequence=false){
  exact(snapshot,sequence?[...SNAPSHOT_KEYS,'decisions']:SNAPSHOT_KEYS,'snapshot');
  if(snapshot.schema!==(sequence?2:1)||snapshot.entry!=='run'||!Array.isArray(snapshot.args)||snapshot.args.length!==1)throw Error('Unsupported snapshot version or entry');snapshot.args.forEach(i32);
  for(const name of ['moduleSha256','instrumentedSha256','memorySha256','seal'])hex(snapshot[name],name);
  bridgeShape(snapshot.bridge,sequence);
  if(sequence){
    if(!Array.isArray(snapshot.decisions)||snapshot.decisions.length>=SEQUENCE_LIMIT)throw Error('Invalid bounded decision history');
    for(const decision of snapshot.decisions){exact(decision,['pending','response'],'decision');i32(decision.response);if(!Array.isArray(decision.pending)||decision.pending.length!==4)throw Error('Invalid decision arguments');decision.pending.forEach(n=>integer(n,0,0xffffffff,'decision argument'));}
  }
  if(!plain(snapshot.globals)||Object.keys(snapshot.globals).length>4096)throw Error('Invalid snapshot globals');
  for(const [name,value]of Object.entries(snapshot.globals)){
    if(!/^__forkwake_global_\d+$/.test(name))throw Error('Foreign snapshot global');
    if(typeof value==='number')i32(value);
    else if(typeof value!=='string'||! /^-?(?:0|[1-9][0-9]{0,18})$/.test(value)||BigInt(value)<-(1n<<63n)||BigInt(value)>=(1n<<63n)||BigInt(value).toString()!==value)throw Error('Invalid exact i64 snapshot global');
  }
  exact(snapshot.continuation,['header','capacity','top','end'],'continuation');
  const c=snapshot.continuation;for(const value of Object.values(c))integer(value,0,LIMITS.memoryBytes,'continuation bound');
  if(c.capacity<16||c.capacity>LIMITS.stackBytes||c.header%4||c.end!==c.header+c.capacity||c.top<=c.header+8||c.top>c.end)throw Error('Invalid continuation interval');
  if(authenticate){const expected=seal(snapshot,key);if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(snapshot.seal,'hex')))throw Error('Snapshot authentication failed; use validated import for another session');}
  const memory=decodeBase64(snapshot.memoryBase64,LIMITS.memoryBytes,'snapshot memory');
  if(!memory.length||memory.length%65536||sha256(memory)!==snapshot.memorySha256||c.end>memory.length)throw Error('Snapshot memory integrity failed');
  const view=new DataView(memory.buffer,memory.byteOffset,memory.byteLength);
  if(view.getUint32(c.header,true)!==c.top||view.getUint32(c.header+4,true)!==c.end)throw Error('Snapshot continuation header mismatch');
  return memory;
}
function globalValues(instance,metadata){return Object.fromEntries(metadata.globals.map(g=>{const v=instance.exports[g.exportName].value;return[g.exportName,g.type==='i64'?v.toString():v];}));}
function pageHashes(memory){return Array.from({length:memory.length/65536},(_,page)=>({page,sha256:sha256(memory.subarray(page*65536,(page+1)*65536))}));}
function create(module,metadata,{bridge,response,raw=false}={}){
  bridge=bridge??{prefix:[],suffix:[],pending:null,sealed:false,ownedCounter:0};
  let instance,phase='initializing',rewindVerified=false,continuation;
  const event=(list,stage,value)=>{if(bridge.prefix.length+bridge.suffix.length>=LIMITS.events)throw Error('Trace event limit exceeded');list.push({stage:u32(stage),value:u32(value)});};
  const env={
    pre_cut(stage,value){if(phase!=='running'||bridge.sealed)throw Error('Pre-cut work was re-executed or invoked during initialization');bridge.ownedCounter++;event(bridge.prefix,stage,value);},
    post_cut(stage,value){if(phase!=='running'||!bridge.pending||(!raw&&!rewindVerified))throw Error('Post-cut callback outside resumed suffix');event(bridge.suffix,stage,value);},
    pending_effect(...args){
      if(phase!=='running')throw Error('Pending effect outside entry execution');const pending=args.map(u32);
      if(raw){if(bridge.pending!==null)throw Error('Only one pending cut is supported');bridge.pending=pending;return response;}
      const x=instance.exports,state=x.asyncify_get_state();
      if(state===2){if(canonical(pending)!==canonical(bridge.pending))throw Error('Pending effect arguments changed after restoration');if(rewindVerified)throw Error('Repeated rewind effect');rewindVerified=true;x.asyncify_stop_rewind();return response;}
      if(state!==0||bridge.pending!==null)throw Error('Only one pending cut is supported');
      bridge.pending=pending;
      const header=u32(x.header_address()),capacity=u32(x.asyncify_capacity()),end=header+capacity;
      if(header%4||capacity<16||capacity>LIMITS.stackBytes||end>x.memory.buffer.byteLength)throw Error('Asyncify storage must be aligned, bounded and present in guest memory');
      const view=new DataView(x.memory.buffer);view.setUint32(header,header+8,true);view.setUint32(header+4,end,true);
      continuation={header,capacity,end};x.asyncify_start_unwind(header);return 0;
    }
  };
  instance=new WebAssembly.Instance(module,{env});
  instance.exports._initialize?.();
  return {instance,bridge,run(args){phase='running';try{return instance.exports.run(...args);}finally{phase='idle';}},get rewindVerified(){return rewindVerified;},get continuation(){return continuation;}};
}
function preparedSeal(body,key){return createHmac('sha256',key).update('Forkwake prepared '+VALIDATION_POLICY+'\n'+canonical(body)).digest('hex');}
function packagePrepared(prepared,key){const body={bytesBase64:Buffer.from(prepared.bytes).toString('base64'),metadata:structuredClone(prepared.metadata)};return {...body,seal:preparedSeal(body,key)};}
function prepare(raw,key,trustedPrepared){
  const originalSha256=sha256(raw);
  if(trustedPrepared!==undefined){
    exact(trustedPrepared,['bytesBase64','metadata','seal'],'trusted transform cache');hex(trustedPrepared.seal,'cache seal');
    const body={bytesBase64:trustedPrepared.bytesBase64,metadata:trustedPrepared.metadata},expected=preparedSeal(body,key);
    if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(trustedPrepared.seal,'hex')))throw Error('Trusted transform cache authentication failed');
    const bytes=decodeBase64(trustedPrepared.bytesBase64,LIMITS.moduleBytes,'transformed module'),metadata=structuredClone(trustedPrepared.metadata);
    if(!plain(metadata)||metadata.version!==2||metadata.validationPolicy!==VALIDATION_POLICY||metadata.binaryenVersion!==132||metadata.originalSha256!==originalSha256||metadata.instrumentedSha256!==sha256(bytes))throw Error('Trusted transform cache binding or validation policy mismatch');
    return {bytes,metadata,module:new WebAssembly.Module(bytes)};
  }
  if(lastPrepared?.metadata.originalSha256===originalSha256)return lastPrepared;
  const transformed=instrument(raw);lastPrepared={...transformed,module:new WebAssembly.Module(transformed.bytes)};return lastPrepared;
}
function capturePrepared(prepared,args,key){
  const source=create(prepared.module,prepared.metadata),x=source.instance.exports;
  source.run(args);
  if(x.asyncify_get_state()!==1||!source.bridge.pending||!source.continuation)throw Error('Entry completed without a captured continuation');
  x.asyncify_stop_unwind();source.bridge.sealed=true;
  const memory=Buffer.from(x.memory.buffer),c=source.continuation,top=new DataView(x.memory.buffer).getUint32(c.header,true);
  if(top<=c.header+8||top>c.end)throw Error('Continuation stack is empty or overflowed');
  const snapshot={schema:1,moduleSha256:prepared.metadata.originalSha256,instrumentedSha256:prepared.metadata.instrumentedSha256,entry:'run',args:[...args],memoryBase64:memory.toString('base64'),memorySha256:sha256(memory),globals:globalValues(source.instance,prepared.metadata),bridge:structuredClone(source.bridge),continuation:{...c,top},seal:''};
  snapshot.seal=seal(snapshot,key);validateSnapshot(snapshot,key);
  return {snapshot,summary:{status:'captured',moduleSha256:snapshot.moduleSha256,instrumentedSha256:snapshot.instrumentedSha256,memoryBytes:memory.length,memorySha256:snapshot.memorySha256,globals:snapshot.globals,prefix:snapshot.bridge.prefix,suffix:[],pending:snapshot.bridge.pending,continuationBytes:top-c.header-8,pages:pageHashes(memory),tables:structuredClone(prepared.metadata.tables),checks:{capturedNonemptyStack:true,allMutableGlobalsCaptured:true},scope:'One owned pending effect in a closed wasm32 module; no host process or external capability cloning'}};
}
function validateBinding(snapshot,metadata,memory){
  if(snapshot.moduleSha256!==metadata.originalSha256||snapshot.instrumentedSha256!==metadata.instrumentedSha256)throw Error('Snapshot belongs to a different module or transform');
  if(memory.length/65536<metadata.memory.initial||memory.length/65536>metadata.memory.max)throw Error('Snapshot memory pages outside module bounds');
  const expected=metadata.globals.map(x=>x.exportName).sort(),actual=Object.keys(snapshot.globals).sort();if(canonical(expected)!==canonical(actual))throw Error('Snapshot mutable-global coverage mismatch');
  for(const g of metadata.globals){if(typeof snapshot.globals[g.exportName]!==(g.type==='i64'?'string':'number'))throw Error('Snapshot global type mismatch');}
}
function restore(prepared,snapshot,memory,response){
  validateBinding(snapshot,prepared.metadata,memory);
  const branch=create(prepared.module,prepared.metadata,{bridge:structuredClone(snapshot.bridge),response}),x=branch.instance.exports;
  const pages=(memory.length-x.memory.buffer.byteLength)/65536;
  if(pages<0||!Number.isInteger(pages))throw Error('Cannot restore exact snapshot memory pages');if(pages)x.memory.grow(pages);
  if(x.memory.buffer.byteLength!==memory.length)throw Error('Restored memory size mismatch');new Uint8Array(x.memory.buffer).set(memory);
  for(const g of prepared.metadata.globals)x[g.exportName].value=g.type==='i64'?BigInt(snapshot.globals[g.exportName]):snapshot.globals[g.exportName];
  if(sha256(new Uint8Array(x.memory.buffer))!==snapshot.memorySha256||canonical(globalValues(branch.instance,prepared.metadata))!==canonical(snapshot.globals))throw Error('Restored state differs at cut');
  return branch;
}

/** User job protocol. snapshotKey is trusted app configuration, never a user request field. */
export async function handle(request,{snapshotKey,trustedPrepared,onPrepared}={}){
  if(onPrepared!==undefined&&typeof onPrepared!=='function')throw Error('Trusted onPrepared option must be a function');
  if(plain(request)&&['sequence-capture','sequence-advance','sequence-import'].includes(request.operation))return handleSequence(request,{snapshotKey,trustedPrepared,onPrepared});
  if(!plain(request)||!['capture','fork','import'].includes(request.operation))throw Error('Unsupported operation');
  const fields=request.operation==='capture'?['operation','moduleBase64','entry','args']:request.operation==='fork'?['operation','moduleBase64','snapshot','response']:['operation','moduleBase64','snapshot'];
  exact(request,fields,'job');const key=keyBytes(snapshotKey),raw=decodeBase64(request.moduleBase64,LIMITS.moduleBytes,'module');
  if(request.operation==='capture'){
    if(request.entry!=='run'||!Array.isArray(request.args)||request.args.length!==1)throw Error('ABI requires run(i32)');request.args.forEach(i32);
    const prepared=prepare(raw,key,trustedPrepared);
    // This trusted hook separates preparation from execution before create() can instantiate the guest.
    onPrepared?.();
    const result=capturePrepared(prepared,request.args,key);result.internalPrepared=packagePrepared(prepared,key);return result;
  }
  const memory=validateSnapshot(request.snapshot,key,request.operation==='fork');
  if(sha256(raw)!==request.snapshot.moduleSha256)throw Error('Snapshot belongs to a different module');
  if(request.operation==='fork')i32(request.response);
  const prepared=prepare(raw,key,trustedPrepared);validateBinding(request.snapshot,prepared.metadata,memory);
  onPrepared?.();
  if(request.operation==='import'){
    const recaptured=capturePrepared(prepared,request.snapshot.args,key);
    if(canonical(content(recaptured.snapshot))!==canonical(content(request.snapshot)))throw Error('Imported continuation does not match independently recaptured state');
    recaptured.summary.importReexecutedPrefix=true;recaptured.summary.status='imported';recaptured.internalPrepared=packagePrepared(prepared,key);return recaptured;
  }
  const branch=restore(prepared,request.snapshot,memory,request.response),x=branch.instance.exports;
  x.asyncify_start_rewind(request.snapshot.continuation.header);const result=branch.run(request.snapshot.args);
  if(x.asyncify_get_state()!==0||!branch.rewindVerified)throw Error('Continuation did not finish its verified rewind');
  if(canonical(branch.bridge.prefix)!==canonical(request.snapshot.bridge.prefix)||branch.bridge.ownedCounter!==request.snapshot.bridge.ownedCounter)throw Error('Prefix changed during resumed branch');
  const finalMemory=Buffer.from(x.memory.buffer),globals=globalValues(branch.instance,prepared.metadata);
  return {finalMemoryBase64:finalMemory.toString('base64'),globals,summary:{status:'completed',response:request.response,returnI32:result,returnU32:u32(result),moduleSha256:prepared.metadata.originalSha256,instrumentedSha256:prepared.metadata.instrumentedSha256,memoryBytes:finalMemory.length,memorySha256:sha256(finalMemory),prefix:branch.bridge.prefix,suffix:branch.bridge.suffix,pending:branch.bridge.pending,globals,pages:pageHashes(finalMemory),memoryDiff:diffMemory(memory,finalMemory),globalDiff:diffGlobals(request.snapshot.globals,globals),checks:{restoredMemoryIdentical:true,allMutableGlobalsRestored:true,pendingArgumentsMatched:true,prefixNotReexecuted:true,independentInstance:true}}};
}

/** Test/control route: uninterrupted original bytes, with the same closed ABI. */
export function runReference(raw,args,response){
  args.forEach(i32);i32(response);prepare(raw,sessionKey);const source=create(new WebAssembly.Module(raw),null,{raw:true,response});const result=source.run(args);
  return {returnI32:result,returnU32:u32(result),memory:Buffer.from(source.instance.exports.memory.buffer),prefix:source.bridge.prefix,suffix:source.bridge.suffix,instance:source.instance};
}

/** Falsifier used by tests: restore data but deliberately omit rewind. It must hit the sealed prefix guard. */
export function restartFromSnapshot(raw,snapshot,{snapshotKey}={}){
  const key=keyBytes(snapshotKey),memory=validateSnapshot(snapshot,key),prepared=prepare(raw,key),branch=restore(prepared,snapshot,memory,0);return branch.run(snapshot.args);
}

export const SEQUENCE_LIMIT=32;

function createSequence(module,{bridge,decisions=[],response,rawResponses}={}){
  bridge=bridge??{prefix:[],suffix:[],pending:null,sealed:false,ownedCounter:0};
  decisions=structuredClone(decisions);
  let instance,phase='initializing',rewindVerified=false,continuation,rawIndex=0;
  const event=(list,stage,value)=>{if(bridge.prefix.length+bridge.suffix.length>=LIMITS.events)throw Error('Trace event limit exceeded');list.push({stage:u32(stage),value:u32(value)});};
  const env={
    pre_cut(stage,value){if(phase!=='running'||bridge.sealed)throw Error('Pre-cut work was re-executed or invoked during initialization');bridge.ownedCounter++;event(bridge.prefix,stage,value);},
    post_cut(stage,value){if(phase!=='running'||!bridge.pending||(!rawResponses&&!rewindVerified)||(!rawResponses&&instance.exports.asyncify_get_state()!==0))throw Error('Post-cut callback outside resumed suffix');event(bridge.suffix,stage,value);},
    pending_effect(...args){
      if(phase!=='running')throw Error('Pending effect outside entry execution');const pending=args.map(u32);
      if(rawResponses){if(rawIndex>=rawResponses.length)throw Error('Missing uninterrupted control response');const answer=rawResponses[rawIndex++];decisions.push({pending,response:answer});bridge.pending=pending;bridge.sealed=true;return answer;}
      const x=instance.exports,state=x.asyncify_get_state();
      if(state===2){
        if(rewindVerified||canonical(pending)!==canonical(bridge.pending))throw Error('Pending effect arguments changed after restoration');
        rewindVerified=true;x.asyncify_stop_rewind();decisions.push({pending,response});return response;
      }
      if(state!==0||(bridge.pending&&!rewindVerified))throw Error('Invalid sequence effect transition');
      if(decisions.length>=SEQUENCE_LIMIT)throw Error('Sequence decision limit exceeded');
      bridge.pending=pending;
      const header=u32(x.header_address()),capacity=u32(x.asyncify_capacity()),end=header+capacity;
      if(header%4||capacity<16||capacity>LIMITS.stackBytes||end>x.memory.buffer.byteLength)throw Error('Asyncify storage must be aligned, bounded and present in guest memory');
      const view=new DataView(x.memory.buffer);view.setUint32(header,header+8,true);view.setUint32(header+4,end,true);
      continuation={header,capacity,end};x.asyncify_start_unwind(header);return 0;
    }
  };
  instance=new WebAssembly.Instance(module,{env});instance.exports._initialize?.();
  return {instance,bridge,decisions,run(args){phase='running';try{return instance.exports.run(...args);}finally{phase='idle';}},get rewindVerified(){return rewindVerified;},get continuation(){return continuation;},get rawCount(){return rawIndex;}};
}
function sequenceSummary(prepared,source,memory,status,extra={}){
  return {status,moduleSha256:prepared.metadata.originalSha256,instrumentedSha256:prepared.metadata.instrumentedSha256,memoryBytes:memory.length,memorySha256:sha256(memory),globals:globalValues(source.instance,prepared.metadata),prefix:structuredClone(source.bridge.prefix),suffix:structuredClone(source.bridge.suffix),pending:[...source.bridge.pending],decisions:structuredClone(source.decisions),decisionCount:source.decisions.length,pages:pageHashes(memory),tables:structuredClone(prepared.metadata.tables),scope:'Closed wasm32 sequential owned effects; no host process or external capability cloning',...extra};
}
function cutSequence(prepared,source,args,key,extra={}){
  const x=source.instance.exports;
  if(x.asyncify_get_state()!==1||!source.bridge.pending||!source.continuation)throw Error('Entry completed without a captured continuation');
  x.asyncify_stop_unwind();source.bridge.sealed=true;
  const memory=Buffer.from(x.memory.buffer),c=source.continuation,top=new DataView(x.memory.buffer).getUint32(c.header,true);
  if(top<=c.header+8||top>c.end)throw Error('Continuation stack is empty or overflowed');
  const snapshot={schema:2,moduleSha256:prepared.metadata.originalSha256,instrumentedSha256:prepared.metadata.instrumentedSha256,entry:'run',args:[...args],memoryBase64:memory.toString('base64'),memorySha256:sha256(memory),globals:globalValues(source.instance,prepared.metadata),bridge:structuredClone(source.bridge),continuation:{...c,top},decisions:structuredClone(source.decisions),seal:''};
  snapshot.seal=seal(snapshot,key);validateSnapshot(snapshot,key,true,true);
  return {snapshot,summary:sequenceSummary(prepared,source,memory,'captured',{continuationBytes:top-c.header-8,checks:{capturedNonemptyStack:true,allMutableGlobalsCaptured:true},...extra})};
}
function captureSequencePrepared(prepared,args,key){const source=createSequence(prepared.module);source.run(args);return cutSequence(prepared,source,args,key);}
function advanceSequencePrepared(prepared,snapshot,memory,response,key){
  validateBinding(snapshot,prepared.metadata,memory);
  const branch=createSequence(prepared.module,{bridge:structuredClone(snapshot.bridge),decisions:snapshot.decisions,response}),x=branch.instance.exports;
  const pages=(memory.length-x.memory.buffer.byteLength)/65536;
  if(pages<0||!Number.isInteger(pages))throw Error('Cannot restore exact snapshot memory pages');if(pages)x.memory.grow(pages);
  if(x.memory.buffer.byteLength!==memory.length)throw Error('Restored memory size mismatch');new Uint8Array(x.memory.buffer).set(memory);
  for(const g of prepared.metadata.globals)x[g.exportName].value=g.type==='i64'?BigInt(snapshot.globals[g.exportName]):snapshot.globals[g.exportName];
  if(sha256(new Uint8Array(x.memory.buffer))!==snapshot.memorySha256||canonical(globalValues(branch.instance,prepared.metadata))!==canonical(snapshot.globals))throw Error('Restored state differs at cut');
  x.asyncify_start_rewind(snapshot.continuation.header);const result=branch.run(snapshot.args),state=x.asyncify_get_state();
  if(![0,1].includes(state)||!branch.rewindVerified)throw Error('Continuation did not finish its verified rewind');
  if(canonical(branch.bridge.prefix)!==canonical(snapshot.bridge.prefix)||branch.bridge.ownedCounter!==snapshot.bridge.ownedCounter||canonical(branch.bridge.suffix.slice(0,snapshot.bridge.suffix.length))!==canonical(snapshot.bridge.suffix)||canonical(branch.decisions.slice(0,-1))!==canonical(snapshot.decisions))throw Error('Captured history changed during resumed branch');
  const checks={restoredMemoryIdentical:true,allMutableGlobalsRestored:true,pendingArgumentsMatched:true,prefixNotReexecuted:true,historyNotReexecuted:true,independentInstance:true};
  if(state===1){const out=cutSequence(prepared,branch,snapshot.args,key);out.summary.checks={...out.summary.checks,...checks};out.summary.response=response;out.summary.memoryDiff=diffMemory(memory,Buffer.from(out.snapshot.memoryBase64,'base64'));out.summary.globalDiff=diffGlobals(snapshot.globals,out.snapshot.globals);return out;}
  const finalMemory=Buffer.from(x.memory.buffer),globals=globalValues(branch.instance,prepared.metadata);
  return {finalMemoryBase64:finalMemory.toString('base64'),globals,summary:sequenceSummary(prepared,branch,finalMemory,'completed',{response,returnI32:result,returnU32:u32(result),memoryDiff:diffMemory(memory,finalMemory),globalDiff:diffGlobals(snapshot.globals,globals),checks})};
}
async function handleSequence(request,{snapshotKey,trustedPrepared,onPrepared}){
  const capture=request.operation==='sequence-capture',advance=request.operation==='sequence-advance';
  exact(request,capture?['operation','moduleBase64','entry','args']:advance?['operation','moduleBase64','snapshot','response']:['operation','moduleBase64','snapshot'],'job');
  const key=keyBytes(snapshotKey),raw=decodeBase64(request.moduleBase64,LIMITS.moduleBytes,'module');
  let memory;
  if(capture){if(request.entry!=='run'||!Array.isArray(request.args)||request.args.length!==1)throw Error('ABI requires run(i32)');request.args.forEach(i32);}
  else{memory=validateSnapshot(request.snapshot,key,advance,true);if(sha256(raw)!==request.snapshot.moduleSha256)throw Error('Snapshot belongs to a different module');if(advance)i32(request.response);}
  const prepared=prepare(raw,key,trustedPrepared);if(!capture)validateBinding(request.snapshot,prepared.metadata,memory);onPrepared?.();
  if(capture){const out=captureSequencePrepared(prepared,request.args,key);out.internalPrepared=packagePrepared(prepared,key);return out;}
  if(advance)return advanceSequencePrepared(prepared,request.snapshot,memory,request.response,key);
  let recaptured=captureSequencePrepared(prepared,request.snapshot.args,key);
  for(const decision of request.snapshot.decisions){
    if(!recaptured.snapshot)throw Error('Imported continuation does not match independently recaptured state');
    recaptured=advanceSequencePrepared(prepared,recaptured.snapshot,Buffer.from(recaptured.snapshot.memoryBase64,'base64'),decision.response,key);
  }
  if(!recaptured.snapshot||canonical(content(recaptured.snapshot))!==canonical(content(request.snapshot)))throw Error('Imported continuation does not match independently recaptured state');
  recaptured.summary.status='imported';recaptured.summary.importReexecutedPrefix=true;recaptured.summary.importReexecutedDecisions=request.snapshot.decisions.length;recaptured.internalPrepared=packagePrepared(prepared,key);return recaptured;
}

/** Uninterrupted original-module control for a complete explicitly supplied response sequence. */
export function runSequenceReference(raw,args,responses){
  if(!Array.isArray(args)||args.length!==1||!Array.isArray(responses)||!responses.length||responses.length>SEQUENCE_LIMIT)throw Error('Invalid control response sequence');args.forEach(i32);responses.forEach(i32);prepare(raw,sessionKey);
  const source=createSequence(new WebAssembly.Module(raw),{rawResponses:[...responses]}),result=source.run(args);
  if(source.rawCount!==responses.length)throw Error('Uninterrupted control has unused responses');
  return {returnI32:result,returnU32:u32(result),memory:Buffer.from(source.instance.exports.memory.buffer),prefix:source.bridge.prefix,suffix:source.bridge.suffix,decisions:source.decisions,instance:source.instance};
}
