import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Worker} from 'node:worker_threads';
import binaryen from 'binaryen';
import {instrument,sha256,LIMITS,VALIDATION_POLICY} from '../lib/transform.mjs';
import {handle,runReference,restartFromSnapshot,decodeBase64} from '../lib/runtime.mjs';
import {diffMemory} from '../lib/diff.mjs';

const key='17'.repeat(32),otherKey='29'.repeat(32);
const fixture=(shipped,probe)=>{const path=new URL(shipped,import.meta.url);return fs.readFileSync(fs.existsSync(path)?path:new URL(probe,import.meta.url));};
const encoded=bytes=>Buffer.from(bytes).toString('base64');
const capture=(raw,arg=4,secret=key)=>handle({operation:'capture',moduleBase64:encoded(raw),entry:'run',args:[arg]},{snapshotKey:secret});
const fork=(raw,snapshot,response,secret=key)=>handle({operation:'fork',moduleBase64:encoded(raw),snapshot,response},{snapshotKey:secret});
const continuation=()=>fixture('../examples/continuation/fixture.raw.wasm','../../branchpoint-wasm/fixture.raw.wasm');
const sqlite=()=>fixture('../examples/sqlite/workflow.raw.wasm','../../branchpoint-wasm/sqlite-proof/workflow.raw.wasm');
function compile(wat){const m=binaryen.parseText(wat);try{m.setFeatures(binaryen.Features.MutableGlobals|binaryen.Features.ReferenceTypes|binaryen.Features.BulkMemory);return Uint8Array.from(m.emitBinary());}finally{m.dispose();}}
const preamble=`(import "env" "pre_cut" (func $pre (param i32 i32)))
 (import "env" "post_cut" (func $post (param i32 i32)))
 (import "env" "pending_effect" (func $pending (param i32 i32 i32 i32) (result i32)))
 (memory (export "memory") 1 2)
 (func (export "header_address") (result i32) (i32.const 1024))
 (func (export "asyncify_capacity") (result i32) (i32.const 4096))`;
const run=`(func $run (export "run") (param $arg i32) (result i32)
 (local $r i32) (call $pre (i32.const 1) (local.get $arg))
 (local.set $r (call $pending (i32.const 17) (local.get $arg) (i32.const 64) (i32.const 1)))
 (call $post (i32.const 1) (local.get $r)) (local.get $r))`;
const simple=()=>compile(`(module ${preamble} ${run})`);
const rows=(memory,address,count=18)=>Array.from({length:count},(_,i)=>memory.readUInt32LE(address+i*4));
function readCString(memory,address){const end=memory.indexOf(0,address);assert(end>=address);return memory.subarray(address,end).toString('utf8');}

test('nested compiled C produces six actual continuation branches matching uninterrupted raw A/A controls',async()=>{
  const raw=continuation(),saved=await capture(raw,37),before=JSON.stringify(saved.snapshot);
  assert(saved.summary.continuationBytes>0);assert.equal(saved.summary.prefix.length,3);assert.equal(saved.summary.suffix.length,0);
  for(const response of [1,9,-1,0,2147483647,-2147483648]){
    const b=await fork(raw,saved.snapshot,response),a=runReference(raw,[37],response),aa=runReference(raw,[37],response);
    assert.equal(a.memory.toString('base64'),aa.memory.toString('base64'));
    assert.equal(b.summary.returnU32,a.returnU32);assert.deepEqual(b.summary.prefix,a.prefix);assert.deepEqual(b.summary.suffix,a.suffix);
    const memory=Buffer.from(b.finalMemoryBase64,'base64'),x=a.instance.exports;
    assert.deepEqual(rows(memory,x.arena_address(),4),rows(a.memory,x.arena_address(),4));
    assert.equal(memory.readUInt32LE(x.header_address()),saved.snapshot.continuation.header+8);
    assert(b.summary.checks.prefixNotReexecuted);assert(b.summary.checks.pendingArgumentsMatched);
  }
  assert.equal(JSON.stringify(saved.snapshot),before);
  assert.throws(()=>restartFromSnapshot(raw,saved.snapshot,{snapshotKey:key}),/Pre-cut work/);
});

test('actual SQLite live transaction, prepared cursor and allocated heap fork commit, denial and timeout',async()=>{
  const raw=sqlite(),saved=await capture(raw,4),snapshotHash=sha256(Buffer.from(JSON.stringify(saved.snapshot))),branches=[];
  assert(saved.summary.tables.some(t=>t.initial>100));assert(saved.summary.continuationBytes>0);
  for(const response of [1,0,-1]){
    const b=await fork(raw,saved.snapshot,response),a=runReference(raw,[4],response),aa=runReference(raw,[4],response),memory=Buffer.from(b.finalMemoryBase64,'base64'),x=a.instance.exports;
    assert.equal(a.memory.toString('base64'),aa.memory.toString('base64'),'raw A/A must be deterministic');
    const actual=rows(memory,x.results_address()),expected=rows(a.memory,x.results_address());assert.deepEqual(actual,expected);
    assert.equal(b.summary.returnU32,a.returnU32);assert.deepEqual(b.summary.suffix,a.suffix);assert.deepEqual(b.summary.prefix,a.prefix);
    assert.equal(actual[1],0,'live transaction at resume');assert.equal(actual[2],1,'busy prepared cursor');assert.equal(actual[9],1);assert.equal(actual[14],0);
    let canary=0n;for(let i=0;i<16384;i++)canary=(canary*33n+BigInt(4*17+i*97))&0xffffffffn;
    assert.equal(actual[10],Number(canary),'independent allocated-heap oracle');
    assert.deepEqual(memory.subarray(x.canary_address(),x.canary_address()+65536),a.memory.subarray(x.canary_address(),x.canary_address()+65536));
    if(x.database_json_address)assert.equal(readCString(memory,x.database_json_address()),readCString(a.memory,x.database_json_address()));
    if(x.payment_address){const callback=rows(memory,x.results_address(),22);assert.equal(callback[19],1,'SQL callback entered once');assert.equal(callback[20],1,'sqlite3_step is executing at cut');assert.equal(callback[21],0,'transaction active inside SQL callback');assert.deepEqual(callback,rows(a.memory,x.results_address(),22));}
    if(response===1){assert.equal(actual[5],3);assert.equal(actual[6],1);assert.equal(actual[7],1);assert.equal(actual[13],120);}
    else{assert.equal(actual[5],2);assert.equal(actual[6],0);assert.equal(actual[7],0);assert.equal(actual[8],1);assert.equal(actual[13],0);}
    assert.equal(actual[16],response===0?1:0);assert.equal(actual[17],response===-1?1:0);
    assert(b.summary.memoryDiff.changedBytes>0);branches.push(b);
  }
  const ab=diffMemory(Buffer.from(branches[1].finalMemoryBase64,'base64'),Buffer.from(branches[2].finalMemoryBase64,'base64'));assert(ab.changedBytes>0,'actual denial and timeout bytes differ');
  const sibling=branches[1].finalMemoryBase64,mutable=Buffer.from(branches[0].finalMemoryBase64,'base64');mutable.fill(255);assert.equal(branches[1].finalMemoryBase64,sibling);
  assert.equal((await fork(raw,saved.snapshot,0)).finalMemoryBase64,sibling,'snapshot reuse independent of branch order');
  assert.equal(sha256(Buffer.from(JSON.stringify(saved.snapshot))),snapshotHash);
  assert.throws(()=>restartFromSnapshot(raw,saved.snapshot,{snapshotKey:key}),/Pre-cut work/);
});

test('mutable i64 values preserve bits beyond JavaScript precision through JSON snapshot and restoration',async()=>{
  const raw=compile(`(module ${preamble}
   (global $g (mut i64) (i64.const 9223372036854775000))
   (func (export "run") (param $a i32) (result i32) (local $r i32)
    (global.set $g (i64.add (global.get $g) (i64.extend_i32_s (local.get $a))))
    (call $pre (i32.const 1) (local.get $a))
    (local.set $r (call $pending (i32.const 99) (local.get $a) (i32.const 64) (i32.const 2)))
    (global.set $g (i64.add (global.get $g) (i64.extend_i32_s (local.get $r))))
    (i64.store (i32.const 64) (global.get $g))
    (call $post (i32.const 1) (local.get $r)) (local.get $r)))`);
  const saved=await capture(raw,7),snapshot=JSON.parse(JSON.stringify(saved.snapshot));assert(Object.values(snapshot.globals).includes('9223372036854775007'));
  const branch=await fork(raw,snapshot,-9);assert.equal(Buffer.from(branch.finalMemoryBase64,'base64').readBigInt64LE(64),9223372036854774998n);assert(branch.summary.globalDiff.length>0);
});

test('guest memory growth before and after the cut preserves exact restored page count',async()=>{
  const raw=compile(`(module ${preamble.replace('1 2','1 4')}
   (func (export "run") (param $a i32) (result i32) (local $r i32)
    (drop (memory.grow (i32.const 1)))
    (i32.store (i32.const 90000) (local.get $a))
    (call $pre (i32.const 1) (memory.size))
    (local.set $r (call $pending (i32.const 1) (local.get $a) (i32.const 90000) (i32.const 1)))
    (drop (memory.grow (i32.const 1)))
    (i32.store (i32.const 140000) (local.get $r))
    (call $post (i32.const 1) (memory.size)) (local.get $r)))`);
  const saved=await capture(raw,37);assert.equal(saved.summary.memoryBytes,2*65536);
  const branch=await fork(raw,saved.snapshot,-17),memory=Buffer.from(branch.finalMemoryBase64,'base64'),control=runReference(raw,[37],-17);
  assert.equal(memory.length,3*65536);assert.equal(memory.readInt32LE(90000),37);assert.equal(memory.readInt32LE(140000),-17);assert.deepEqual(branch.summary.suffix,control.suffix);
});

test('snapshot authentication and strict shape reject mutation, foreign values and wrong-session forks',async()=>{
  const raw=simple(),saved=await capture(raw);
  const mutations=[s=>s.args[0]++,s=>s.bridge.pending[0]++,s=>s.memorySha256='0'.repeat(64),s=>s.globals.foreign=1,s=>s.continuation.top++,s=>s.extra=true,s=>s.globals[Object.keys(s.globals)[0]]=1.5];
  for(const mutate of mutations){const s=structuredClone(saved.snapshot);mutate(s);await assert.rejects(fork(raw,s,1),/Invalid|Snapshot|Foreign/);}
  await assert.rejects(fork(raw,saved.snapshot,1,otherKey),/authentication/);
  await assert.rejects(fork(continuation(),saved.snapshot,1),/different module/);
  for(const invalid of [true,1.5,2147483648,-2147483649])await assert.rejects(fork(raw,saved.snapshot,invalid),/i32/);
});

test('portable import independently recaptures bytes before issuing a new session seal',async()=>{
  const raw=simple(),saved=await capture(raw,11);
  const imported=await handle({operation:'import',moduleBase64:encoded(raw),snapshot:saved.snapshot},{snapshotKey:otherKey});
  assert.equal(imported.summary.status,'imported');assert(imported.summary.importReexecutedPrefix);assert.notEqual(imported.snapshot.seal,saved.snapshot.seal);
  assert.equal((await fork(raw,imported.snapshot,23,otherKey)).summary.returnI32,23);
  const forged=structuredClone(saved.snapshot),memory=Buffer.from(forged.memoryBase64,'base64');memory[60000]^=1;forged.memoryBase64=encoded(memory);forged.memorySha256=sha256(memory);
  await assert.rejects(handle({operation:'import',moduleBase64:encoded(raw),snapshot:forged},{snapshotKey:otherKey}),/independently recaptured/);
});

test('trusted transform cache is sealed, source-bound and independent of caller mutation',async()=>{
  const raw=simple(),saved=await capture(raw,11),options={snapshotKey:key,trustedPrepared:saved.internalPrepared};
  const branch=await handle({operation:'fork',moduleBase64:encoded(raw),snapshot:saved.snapshot,response:37},options);assert.equal(branch.summary.returnI32,37);
  for(const mutate of [p=>p.metadata.originalSha256='0'.repeat(64),p=>p.bytesBase64='AAAA',p=>p.metadata.globals=[]]){
    const bad=structuredClone(saved.internalPrepared);mutate(bad);await assert.rejects(handle({operation:'fork',moduleBase64:encoded(raw),snapshot:saved.snapshot,response:37},{snapshotKey:key,trustedPrepared:bad}),/cache authentication/);
  }
  saved.internalPrepared.metadata.globals=[];
  assert.equal((await fork(raw,saved.snapshot,29)).summary.returnI32,29,'returned metadata must not mutate runtime cache');
});

test('worker protocol restores a sealed cache in another fresh worker and rejects untrusted key fields',async()=>{
  const job=(request,trustedPrepared)=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../lib/worker.mjs',import.meta.url),{workerData:{request,snapshotKey:key,trustedPrepared},resourceLimits:{maxOldGenerationSizeMb:256}});
    const timer=setTimeout(()=>{worker.terminate();reject(Error('Worker deadline exceeded'));},30000);
    let phaseCount=0;
    worker.on('message',message=>{if(message.phase==='execution'){assert.deepEqual(message,{phase:'execution'});phaseCount++;return;}clearTimeout(timer);worker.terminate();resolve({...message,phaseCount});});worker.once('error',error=>{clearTimeout(timer);reject(error);});
  });
  const raw=simple(),moduleBase64=encoded(raw),captureResult=await job({operation:'capture',moduleBase64,entry:'run',args:[7]});assert(captureResult.ok);assert.equal(captureResult.phaseCount,1);
  const completed=await job({operation:'fork',moduleBase64,snapshot:captureResult.result.snapshot,response:42},captureResult.result.internalPrepared);assert(completed.ok);assert.equal(completed.result.summary.returnI32,42);assert.equal(completed.phaseCount,1);
  const bad=await job({operation:'capture',moduleBase64,entry:'run',args:[7],snapshotKey:otherKey});assert.equal(bad.ok,false);assert.match(bad.error,/job shape/);assert.equal(bad.phaseCount,0);
});

test('preparation phase occurs exactly once before every guest instance and initialization',async()=>{
  const raw=simple(),moduleBase64=encoded(raw),original=WebAssembly.Instance;let phases=0,instances=0;
  WebAssembly.Instance=function(...args){assert.equal(phases,1,'guest cannot instantiate before the trusted preparation hook');instances++;return new original(...args);};
  const trusted={snapshotKey:key,onPrepared:()=>{phases++;assert.equal(instances,0);}};
  try{
    const saved=await handle({operation:'capture',moduleBase64,entry:'run',args:[7]},trusted);assert.equal(phases,1);assert.equal(instances,1);
    for(const request of [{operation:'fork',moduleBase64,snapshot:saved.snapshot,response:1},{operation:'import',moduleBase64,snapshot:saved.snapshot}]){
      phases=0;instances=0;await handle(request,{...trusted,trustedPrepared:saved.internalPrepared});assert.equal(phases,1);assert.equal(instances,1);
    }
    const initialization=compile(`(module ${preamble} ${run} (func (export "_initialize") (call $pre (i32.const 1) (i32.const 2))))`);
    phases=0;instances=0;await assert.rejects(handle({operation:'capture',moduleBase64:encoded(initialization),entry:'run',args:[1]},trusted),/initialization/);assert.equal(phases,1);assert.equal(instances,1);
    const unsupported=compile(`(module (import "foreign" "network" (func $network)) ${preamble} ${run})`);
    phases=0;instances=0;await assert.rejects(handle({operation:'capture',moduleBase64:encoded(unsupported),entry:'run',args:[1]},trusted),/Unowned/);assert.equal(phases,0);assert.equal(instances,0);
  }finally{WebAssembly.Instance=original;}
});

test('module preflight rejects unsupported capabilities, mutation and ABI shapes before execution',()=>{
  const cases=[
    [`(module ${preamble} ${run} (func $boot) (start $boot))`,/Start/],
    [`(module ${preamble} ${run} (table (export "table") 1 1 funcref))`,/tables/],
    [`(module ${preamble} ${run} (table 1 1 funcref) (func $t (table.set (i32.const 0) (ref.null func))))`,/table/],
    [`(module ${preamble} ${run} (table 1 1 funcref) (elem $passive func $run))`,/element/],
    [`(module ${preamble} ${run} (data $passive "abc"))`,/Passive data/],
    [`(module ${preamble} ${run} (global $f (mut f32) (f32.const 1)))`,/Mutable globals/],
    [`(module (import "evil" "file" (func $bad)) ${preamble} ${run})`,/Unowned/],
    [`(module ${preamble.replace('1 2','1 513')} ${run})`,/32 MiB/],
    [`(module ${preamble.replace('1 2','1')} ${run})`,/explicit maximum/],
    [`(module ${preamble} (func (export "run") (result i32) (i32.const 1)))`,/signature/],
    [`(module ${preamble} ${run} (export "__forkwake_fake" (func $run)))`,/reserved/]
  ];
  for(const [wat,expected]of cases)assert.throws(()=>instrument(compile(wat)),expected);
  assert.throws(()=>instrument(new Uint8Array(LIMITS.moduleBytes+1)),/8 MiB/);
});

test('ABI accessor purity rejects the independent wrong-output case before guest instantiation',async()=>{
  const impure=compile(`(module ${preamble.replace('(i32.const 1024))','(i32.store (i32.const 64) (i32.const 9)) (i32.const 1024))')}
   (func (export "run") (param $a i32) (result i32) (local $r i32)
    (call $pre (i32.const 1) (local.get $a))
    (local.set $r (call $pending (i32.const 1) (local.get $a) (i32.const 64) (i32.const 0)))
    (call $post (i32.const 1) (i32.load (i32.const 64)))
    (i32.add (local.get $r) (i32.load (i32.const 64)))))`);
  assert.throws(()=>instrument(impure),/side-effect-free: header_address/);
  await assert.rejects(capture(impure),/side-effect-free: header_address/);
  const cases=[
    ['(global.set $g (i32.const 1)) (i32.const 1024)','(global $g (mut i32) (i32.const 0))'],
    ['(call $dirty) (i32.const 1024)','(func $dirty (i32.store (i32.const 64) (i32.const 9)))'],
    ['(call $pre (i32.const 1) (i32.const 2)) (i32.const 1024)',''],
    ['(drop (memory.grow (i32.const 1))) (i32.const 1024)',''],
    ['(loop $spin (br $spin)) (i32.const 1024)',''],
    ['(i32.div_s (i32.const 1024) (i32.const 0))',''],
    ['(i32.load (i32.const 64))',''],
    ['(call $recursive)','(func $recursive (result i32) (call $recursive))'],
  ];
  for(const [body,extra]of cases){const raw=compile(`(module ${preamble.replace('(i32.const 1024))',body+')')} ${extra} ${run})`);assert.throws(()=>instrument(raw),/side-effect-free/);}
  const badCapacity=compile(`(module ${preamble.replace('(i32.const 4096))','(i32.store (i32.const 64) (i32.const 9)) (i32.const 4096))')} ${run})`);assert.throws(()=>instrument(badCapacity),/side-effect-free: asyncify_capacity/);
  const pure=compile(`(module ${preamble.replace('(i32.const 1024))','(call $pure (i32.const 1000)))')}
   (func $pure (param i32) (result i32) (block (result i32) (i32.add (local.get 0) (i32.const 24)))) ${run})`);
  const saved=await capture(pure);assert.equal(saved.internalPrepared.metadata.validationPolicy,VALIDATION_POLICY);assert.equal((await fork(pure,saved.snapshot,7)).summary.returnI32,7);
});

test('fixed static indirect table recreates owned references in fresh branch instances',async()=>{
  const raw=compile(`(module ${preamble} (table 1 1 funcref)
   (func $plus (param i32) (result i32) (i32.add (local.get 0) (i32.const 19)))
   (elem (i32.const 0) $plus)
   (type $fn (func (param i32) (result i32)))
   (func (export "run") (param $a i32) (result i32) (local $r i32)
    (call $pre (i32.const 1) (local.get $a))
    (local.set $r (call $pending (i32.const 1) (local.get $a) (i32.const 64) (i32.const 0)))
    (call $post (i32.const 1) (local.get $r))
    (call_indirect (type $fn) (local.get $r) (i32.const 0))))`);
  const saved=await capture(raw);assert.equal(saved.summary.tables[0].initial,1);assert.equal((await fork(raw,saved.snapshot,23)).summary.returnI32,42);assert.equal((await fork(raw,saved.snapshot,-2)).summary.returnI32,17);
});

test('one-cut limit and callback phase guards fail closed',async()=>{
  const raw=compile(`(module ${preamble} (func (export "run") (param i32) (result i32)
    (call $pre (i32.const 1) (local.get 0))
    (drop (call $pending (i32.const 1) (i32.const 2) (i32.const 3) (i32.const 4)))
    (call $pending (i32.const 1) (i32.const 2) (i32.const 3) (i32.const 4))))`);
  const saved=await capture(raw);await assert.rejects(fork(raw,saved.snapshot,1),/one pending cut/);
  const initialize=compile(`(module ${preamble} ${run} (func (export "_initialize") (call $pre (i32.const 1) (i32.const 2))))`);
  await assert.rejects(capture(initialize),/initialization/);
});

test('memory diff reports exact byte ranges, page hashes, growth and truncation',()=>{
  const a=new Uint8Array(65536),b=new Uint8Array(131072);b[0]=1;b[2]=1;b[65535]=1;
  const d=diffMemory(a,b,{rangeLimit:2});assert.equal(d.changedBytes,65539);assert.equal(d.firstDifference,0);assert.deepEqual(d.ranges,[{offset:0,length:1},{offset:2,length:1}]);assert.equal(d.totalRanges,3);assert(d.rangesTruncated);assert.equal(d.pageHeatmap[1].changedBytes,65536);
  assert.equal(diffMemory(a,a).firstDifference,null);assert.equal(diffMemory(a,a).changedBytes,0);assert.throws(()=>diffMemory(a,b,{rangeLimit:257}),/limit/);
  assert.throws(()=>decodeBase64('YQ',3),/Invalid/);assert.throws(()=>decodeBase64('YR==',3),/Invalid/);
});
