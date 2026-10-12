import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {loadScriptModule,scriptModuleInfo,scriptReportFromMemory,scriptReportFromBytes,scriptObserver,SCRIPT_TEMPLATE_SHA} from '../lib/script-fixture.mjs';
import {injectScript,inspectScriptModule,describeTemplate} from '../lib/script-loader.mjs';
import {handle,runSequenceReference} from '../lib/runtime.mjs';
const base=new URL('../examples/javascript/',import.meta.url);
const digest=b=>createHash('sha256').update(b).digest('hex');

test('source injection changes only the trusted data slot and binds exact UTF-8 bytes',async()=>{
 const template=await fs.readFile(new URL('quickjs-template.raw.wasm',base));const manifest=JSON.parse(await fs.readFile(new URL('template-manifest.json',base),'utf8'));
 assert.equal(digest(template),SCRIPT_TEMPLATE_SHA);assert.deepEqual(describeTemplate(template),manifest);
 const source='\ufeffvar resultI32; resultI32=decision("Δ雪", {text:"café"}); emit("終");';
 const loaded=await loadScriptModule(source,{name:'unicode.js'});assert.equal(loaded.sourceSha256,digest(Buffer.from(source)));assert.equal(scriptModuleInfo(loaded.bytes).source,source);
 assert.equal(digest(template),SCRIPT_TEMPLATE_SHA);
 const changed=Buffer.from(loaded.bytes);changed[manifest.slot.binaryOffset-1]^=1;assert.throws(()=>inspectScriptModule(changed,manifest),/differ/);assert.equal(scriptModuleInfo(changed),null);
 const hidden=Buffer.from(loaded.bytes);hidden[manifest.slot.binaryOffset+Buffer.byteLength(source)+2]=7;assert.throws(()=>inspectScriptModule(hidden,manifest),/Hidden/);
 const invalid=Buffer.from(loaded.bytes);invalid[manifest.slot.binaryOffset]=255;assert.throws(()=>inspectScriptModule(invalid,manifest));
 for(const bad of ['', 'x\0y', '\ud800', 'a'.repeat(1048576)])await assert.rejects(loadScriptModule(bad));
 assert.throws(()=>injectScript(changed,source,manifest));await assert.rejects(loadScriptModule(source,{name:'bad\nname.js'}));
});

test('named JavaScript futures preserve actual live state and agree with original VM and V8 controls', {timeout:150000},async()=>{
 const receipts=[];
 for(const file of ['workflow.js','corrected.js']){
  const source=await fs.readFile(new URL(file,base),'utf8'),m=await loadScriptModule(source,{name:file}),key='76'.repeat(32),b64=m.bytes.toString('base64');
  const root=await handle({operation:'sequence-capture',moduleBase64:b64,entry:'run',args:[1]},{snapshotKey:key,onGuestResult:scriptObserver(m.bytes,{initialCapture:true})});
  const originalRoot=digest(Buffer.from(JSON.stringify(root.snapshot))),prepared=root.internalPrepared;let terminals=0,violations=0,cuts=0;
  async function walk(node,path){
   const r=scriptReportFromMemory(m.bytes,node.snapshot?.memoryBase64??node.finalMemoryBase64);assert.equal(r.entryCount,1);
   if(node.snapshot){
    ++cuts;assert.equal(r.status,'pending');assert.ok(r.pendingLabel);assert.equal(r.pendingOrdinal,path.length+1);assert.ok(node.summary.continuationBytes>0);const original=digest(Buffer.from(JSON.stringify(node.snapshot)));
    for(const response of [1,0,-1]){
     const child=await handle({operation:'sequence-advance',moduleBase64:b64,snapshot:node.snapshot,response},{snapshotKey:key,trustedPrepared:prepared,onGuestResult:scriptObserver(m.bytes)});
     await walk(child,[...path,response]);assert.equal(digest(Buffer.from(JSON.stringify(node.snapshot))),original);
    }
   }else{
    ++terminals;violations+=r.resultI32===1?1:0;assert.equal(r.status,'completed');assert.equal(r.allocatedBytes,0);assert.ok(r.peakAllocatedBytes<=r.heapLimitBytes);
    const reference=runSequenceReference(m.bytes,[1],path);assert.equal(node.summary.returnI32,reference.returnI32);assert.deepEqual(node.summary.decisions,reference.decisions);assert.deepEqual(node.summary.prefix,reference.prefix);assert.deepEqual(node.summary.suffix,reference.suffix);assert.deepEqual(r,scriptReportFromBytes(m.bytes,reference.memory));
    let index=0,output;const context={seed:1,decision(){assert.ok(index<path.length);return path[index++];},emit(text){output=text;}};await vm.runInNewContext(source,context,{timeout:1000});assert.equal(index,path.length);assert.equal(output,r.output);assert.equal(context.resultI32,r.resultI32);
   }
  }
  await walk(root,[]);assert.equal(digest(Buffer.from(JSON.stringify(root.snapshot))),originalRoot);assert.equal(root.summary.prefix[0].value,1);
  if(file==='workflow.js')assert.ok(violations>0);else assert.equal(violations,0);
  receipts.push({file,terminals,cuts,violations});
 }
 console.log('Original VM and V8 control receipts:',JSON.stringify(receipts));
});

test('guest errors and result accessors never become accepted endings or false witnesses', {timeout:90000},async()=>{
 const {executeJob}=await import('../lib/jobs.mjs');
 const source=`
 if(seed===1) throw Error('before-first-decision');
 if(seed===2) emit(42);
 if(seed===3) { resultI32=0; } else {
 const which=decision(String.fromCharCode(65279)+'validation',{seed});
 emit(String.fromCharCode(65279)+'actual text');
 if(which===1) Object.defineProperty(globalThis,'resultI32',{get(){Promise.reject(Error('late-rejection'));return 1;}});
 else if(which===2) Object.defineProperty(globalThis,'resultI32',{get(){Promise.resolve().then(()=>{throw Error('late-job')});return 1;}});
 else if(which===3) Object.defineProperty(globalThis,'resultI32',{configurable:true,get(){Promise.resolve().then(()=>Object.defineProperty(globalThis,'resultI32',{value:0}));return 1;}});
 else if(which===4) Object.defineProperty(globalThis,'resultI32',{get(){throw Error('getter-ran');}});
 else if(which===5) { delete globalThis.resultI32; Object.setPrototypeOf(globalThis,{resultI32:1}); }
 else if(which===6) { Promise.reject(Error('unhandled-rejection'));resultI32=1; }
 else if(which===7) { resultI32=2147483648; }
 else if(which===8) { throw Error('after-decision'); }
 else resultI32=-997;
 }`;
 const m=await loadScriptModule(source),b64=m.bytes.toString('base64'),key='a3'.repeat(32);
 const root=await executeJob({operation:'sequence-capture',moduleBase64:b64,entry:'run',args:[0]},{snapshotKey:key});
 assert.equal(scriptReportFromMemory(m.bytes,root.snapshot.memoryBase64).pendingLabel,'\ufeffvalidation');
 for(const response of [1,2,3,4,5,6,7,8])await assert.rejects(executeJob({operation:'sequence-advance',moduleBase64:b64,snapshot:root.snapshot,response},{snapshotKey:key,trustedPrepared:root.internalPrepared}),/JavaScript:/);
 const valid=await executeJob({operation:'sequence-advance',moduleBase64:b64,snapshot:root.snapshot,response:0},{snapshotKey:key,trustedPrepared:root.internalPrepared});
 assert.equal(valid.summary.returnI32,-997);const report=scriptReportFromMemory(m.bytes,valid.finalMemoryBase64);assert.equal(report.status,'completed');assert.equal(report.output,'\ufeffactual text');
 for(const [seed,pattern]of [[1,/before-first-decision/],[2,/emit requires/],[3,/completed without a decision/]])await assert.rejects(executeJob({operation:'sequence-capture',moduleBase64:b64,entry:'run',args:[seed]},{snapshotKey:key,trustedPrepared:root.internalPrepared}),pattern);
});
