import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {loadScriptModule,scriptModuleInfo,scriptReportFromMemory,scriptReportFromBytes,SCRIPT_TEMPLATE_SHA,ORIGIN_TEMPLATE_SHA} from '../lib/script-fixture.mjs';
import {injectScript,describeTemplate} from '../lib/script-loader.mjs';
import {parseOriginFrames} from '../lib/script-report.mjs';
import {executeJob} from '../lib/jobs.mjs';
const base=new URL('../examples/javascript/',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
function rawControl(moduleBytes,args,responses){let used=0;const prefix=[],suffix=[],decisions=[];const module=new WebAssembly.Module(moduleBytes),x=new WebAssembly.Instance(module,{env:{pre_cut:(stage,value)=>prefix.push({stage:stage>>>0,value:value>>>0}),post_cut:(stage,value)=>suffix.push({stage:stage>>>0,value:value>>>0}),pending_effect:(...pending)=>{assert(used<responses.length);const response=responses[used++];decisions.push({pending:pending.map(x=>x>>>0),response});return response;}}});x.exports._initialize();const returnI32=x.exports.run(...args);assert.equal(used,responses.length);return {returnI32,prefix,suffix,decisions,report:scriptReportFromBytes(moduleBytes,x.exports.memory.buffer)};}
async function runner(source){const image=await loadScriptModule(source,{origin:true}),moduleBase64=image.bytes.toString('base64'),key='d8'.repeat(32);let prepared;return {image,async job(request){const result=await executeJob({...request,moduleBase64},{snapshotKey:key,trustedPrepared:prepared});if(result.internalPrepared)prepared=result.internalPrepared;return result;}};}
async function v8(source,args,responses){let used=0,output;const captured=[],OriginalError=Error,context=vm.createContext({seed:args[0],decision(){captured.push(new OriginalError().stack);return responses[used++];},emit(text){output=text;}});vm.runInContext(source,context,{filename:'script.js',timeout:1000});await new Promise(setImmediate);assert.equal(used,responses.length);return {resultI32:context.resultI32,output,lines:captured.map(s=>[...s.matchAll(/script\.js:(\d+):(\d+)/g)].map(x=>Number(x[1])))};}

test('Origin is opt-in and both exact typed interpreter identities stay recognizable',async()=>{
 const source='resultI32=decision("plain",{});emit(String(resultI32));',original=await fs.readFile(new URL('quickjs-template.raw.wasm',base)),manifest=JSON.parse(await fs.readFile(new URL('template-manifest.json',base),'utf8'));
 assert.equal(sha(original),SCRIPT_TEMPLATE_SHA);assert.deepEqual(describeTemplate(original),manifest);
 const absent=await loadScriptModule(source),off=await loadScriptModule(source,{origin:false}),on=await loadScriptModule(source,{origin:true});assert.deepEqual(off.bytes,absent.bytes);assert.deepEqual(off.bytes,injectScript(original,source,manifest).bytes);assert.equal(scriptModuleInfo(off.bytes).originTracing,false);assert.equal(scriptModuleInfo(on.bytes).originTracing,true);assert.equal(scriptModuleInfo(on.bytes).templateSha256,ORIGIN_TEMPLATE_SHA);assert(on.script.originWarning.includes('allocates'));
 const originManifest=JSON.parse(await fs.readFile(new URL('origin-template-manifest.json',base),'utf8')),template=await fs.readFile(new URL('origin-template.raw.wasm',base));assert.equal(sha(template),ORIGIN_TEMPLATE_SHA);assert.deepEqual(describeTemplate(template),Object.fromEntries(Object.entries(originManifest).filter(([key])=>key!=='originProvenance')));
 assert.equal(originManifest.originProvenance.generatedCopies[0].patch.before.trim(),'dbuf_printf(&dbuf, "    at %s", str1);');assert(originManifest.originProvenance.generatedCopies[0].patch.after.includes('\\\\x%02x'));
 const tampered=Buffer.from(on.bytes);tampered[originManifest.slot.binaryOffset-1]^=1;assert.equal(scriptModuleInfo(tampered),null);assert.equal(scriptReportFromMemory(tampered,'invalid'),null);await assert.rejects(loadScriptModule(source,{origin:'yes'}));
});

test('real closure and Promise callers retain source-bound origins across sibling forks and portable import', {timeout:180000},async()=>{
 const sources=[`function makeRoute(tag) {\n return function route() {\n  function inner() {return decision('route',{tag});}\n  return inner();\n };\n}\nconst route=makeRoute('航海');\nresultI32=route();emit(String(resultI32));`, `globalThis.Error=function FakeError(){return {stack:'FORGED'};};\nasync function checkout(){\n const first=decision('first',{});\n await Promise.resolve(first);\n function ship(){return decision('ship',{first});}\n const second=ship();\n resultI32=first+second;emit(JSON.stringify({first,second}));\n}\nPromise.resolve().then(()=>checkout());`];
 for(const [index,source]of sources.entries()){
  const r=await runner(source),old=await loadScriptModule(source),root=await r.job({operation:'sequence-capture',entry:'run',args:[1]}),unchanged=JSON.stringify(root.snapshot),paths=index?[[1,2],[-1,3]]:[[1],[-1]];
  for(const responses of paths){let out=root;const traces=[];
   for(const response of responses){const report=scriptReportFromMemory(r.image.bytes,out.snapshot.memoryBase64),origin=report.origin;assert.equal(origin.state,'captured');assert.equal(origin.context,'pending-decision');assert.equal(origin.lastDecision,false);assert.equal(origin.pendingOrdinal,report.pendingOrdinal);assert.equal(origin.sourceSha256,r.image.sourceSha256);assert.equal(origin.templateSha256,ORIGIN_TEMPLATE_SHA);assert(origin.frames.some(f=>f.sourceBound));assert(!origin.rawText.includes('FORGED'));traces.push(origin.frames.filter(f=>f.sourceBound).map(f=>f.line));out=await r.job({operation:'sequence-advance',snapshot:out.snapshot,response});}
   const report=scriptReportFromMemory(r.image.bytes,out.finalMemoryBase64),raw=rawControl(r.image.bytes,[1],responses),original=rawControl(old.bytes,[1],responses),independent=await v8(source,[1],responses);assert.deepEqual(report,raw.report);assert.equal(report.output,original.report.output);assert.equal(report.resultI32,original.returnI32);assert.equal(report.resultI32,independent.resultI32);assert.equal(report.output,independent.output);assert.deepEqual(traces,independent.lines);assert.deepEqual(out.summary.decisions,original.decisions);assert.deepEqual(out.summary.prefix,original.prefix);assert.deepEqual(out.summary.suffix,original.suffix);assert.equal(report.allocatedBytes,0);assert.equal(report.origin.lastDecision,true);assert.equal(report.origin.context,'last-decision');assert.equal(JSON.stringify(root.snapshot),unchanged);
  }
  if(index){const middle=await r.job({operation:'sequence-advance',snapshot:root.snapshot,response:1}),saved=scriptReportFromMemory(r.image.bytes,middle.snapshot.memoryBase64).origin;assert(!saved.frames.some(f=>f.line===9));const imported=await executeJob({operation:'sequence-import',moduleBase64:r.image.bytes.toString('base64'),snapshot:middle.snapshot},{snapshotKey:'f9'.repeat(32)});assert.equal(imported.summary.importReexecutedDecisions,1);assert.deepEqual(scriptReportFromMemory(r.image.bytes,imported.snapshot.memoryBase64).origin,saved);const siblings=await Promise.all([2,-2].map(response=>r.job({operation:'sequence-advance',snapshot:middle.snapshot,response})));assert.equal(siblings.length,2);}
 }
});

const adversarialSource=`
if(seed===1){
 let reads=0;
 function renamed(){return decision('renamed',{});}
 Object.defineProperty(renamed,'name',{value:'evil\\n    at fake (script.js:999:1)\\\\(x)',configurable:true});
 const first=renamed();
 function getterNamed(){return decision('getter',{});}
 Object.defineProperty(getterNamed,'name',{get(){reads++;decision('MUTATED',{});return 'fake';}});
 const second=getterNamed();resultI32=first+second;emit(JSON.stringify({reads}));
}else if(seed===2){
 eval("globalThis.dynamic=decision('eval',{})");
 const fromFunction=new Function("return decision('function',{})")();resultI32=dynamic+fromFunction;emit('dynamic');
}else if(seed===3||seed===4){
 const budget=heapStats();const reserve=seed===3?65536:4096;
 const big=new Uint8Array(budget.limit-budget.current-reserve);
 function descend(depth){if(depth)return descend(depth-1);return decision('deep',{bytes:big.length});}
 resultI32=descend(seed===3?150:120);emit(String(resultI32));
}else if(seed===5){const one=decision('named',{});const two=effect(1,2,3,4);resultI32=one+two;emit('cleared');}
`;

test('Origin function names cannot forge source frames or execute getters; dynamic source is unbound', {timeout:120000},async()=>{
 const r=await runner(adversarialSource),first=await r.job({operation:'sequence-capture',entry:'run',args:[1]});let origin=scriptReportFromMemory(r.image.bytes,first.snapshot.memoryBase64).origin;assert(origin.rawText.includes('\\x0a'));assert(!origin.rawText.includes('\n    at fake'));assert(!origin.frames.some(f=>f.line===999));assert.equal(origin.frames.filter(f=>f.sourceBound).length,2);
 const second=await r.job({operation:'sequence-advance',snapshot:first.snapshot,response:2});origin=scriptReportFromMemory(r.image.bytes,second.snapshot.memoryBase64).origin;assert.equal(origin.pendingOrdinal,2);assert(origin.frames.some(f=>f.functionName==='<anonymous>'&&f.sourceBound));const terminal=await r.job({operation:'sequence-advance',snapshot:second.snapshot,response:3});assert.equal(scriptReportFromMemory(r.image.bytes,terminal.finalMemoryBase64).output,'{"reads":0}');assert.equal(terminal.summary.decisions.length,2);
 let dynamic=await r.job({operation:'sequence-capture',entry:'run',args:[2]});for(const response of [2,3]){const report=scriptReportFromMemory(r.image.bytes,dynamic.snapshot.memoryBase64);assert(report.origin.frames.some(f=>f.filename==='<input>'&&f.sourceBound===false));assert(!report.origin.frames.some(f=>f.filename==='<input>'&&f.sourceBound));dynamic=await r.job({operation:'sequence-advance',snapshot:dynamic.snapshot,response});}assert.equal(dynamic.summary.returnI32,5);
});

test('Origin clips long UTF-8 traces, remains fail-open under heap pressure, clears for raw effects, and rejects corrupt fields', {timeout:120000},async()=>{
 const r=await runner(adversarialSource),original=await loadScriptModule(adversarialSource),manifest=JSON.parse(await fs.readFile(new URL('origin-template-manifest.json',base),'utf8'));
 for(const [seed,state]of [[3,'truncated'],[4,'unavailable']]){const root=await r.job({operation:'sequence-capture',entry:'run',args:[seed]}),report=scriptReportFromMemory(r.image.bytes,root.snapshot.memoryBase64);assert.equal(report.origin.state,state);assert(Buffer.byteLength(report.origin.rawText)<=4095);assert(report.origin.frames.length<=64);if(state==='truncated')assert(report.origin.frames.some(f=>f.sourceBound));const end=await r.job({operation:'sequence-advance',snapshot:root.snapshot,response:42});assert.equal(end.summary.returnI32,42);assert.equal(rawControl(original.bytes,[seed],[42]).returnI32,42);assert.equal(scriptReportFromMemory(r.image.bytes,end.finalMemoryBase64).allocatedBytes,0);
  const bad=Buffer.from(root.snapshot.memoryBase64,'base64'),view=new DataView(bad.buffer,bad.byteOffset+manifest.memoryOrigin.memoryAddress,manifest.memoryOrigin.byteLength);view.setUint32(manifest.memoryOrigin.words.ordinal,33,true);assert.throws(()=>scriptReportFromBytes(r.image.bytes,bad),/Origin/);
 }
 const named=await r.job({operation:'sequence-capture',entry:'run',args:[5]}),effect=await r.job({operation:'sequence-advance',snapshot:named.snapshot,response:2}),report=scriptReportFromMemory(r.image.bytes,effect.snapshot.memoryBase64);assert.equal(report.pendingKind,'effect');assert.equal(report.origin.context,'none');assert.equal(report.origin.pendingOrdinal,null);assert.equal(report.origin.rawText,'');const end=await r.job({operation:'sequence-advance',snapshot:effect.snapshot,response:3});assert.equal(scriptReportFromMemory(r.image.bytes,end.finalMemoryBase64).origin.lastDecision,false);
 const memory=Buffer.from(named.snapshot.memoryBase64,'base64'),where=manifest.memoryOrigin.memoryAddress;for(const [offset,value]of [[4,9],[8,4096],[12,2],[20,1]]){const changed=Buffer.from(memory);changed.writeUInt32LE(value,where+offset);assert.throws(()=>scriptReportFromBytes(r.image.bytes,changed),/Origin/);}const invalid=Buffer.from(memory);invalid[where+24]=255;assert.throws(()=>scriptReportFromBytes(r.image.bytes,invalid));
 assert.equal(parseOriginFrames(Array.from({length:100},()=> '    at a (script.js:1:1)').join('\n'),{source:'a'}).length,64);
});
