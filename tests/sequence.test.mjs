import test from 'node:test';
import assert from 'node:assert/strict';
import binaryen from 'binaryen';
import {handle,runSequenceReference} from '../lib/runtime.mjs';
const key='31'.repeat(32),other='42'.repeat(32),enc=b=>Buffer.from(b).toString('base64');
function moduleBytes(){const m=binaryen.parseText(`(module
(import "env" "pre_cut" (func $pre (param i32 i32)))
(import "env" "pending_effect" (func $effect (param i32 i32 i32 i32) (result i32)))
(import "env" "post_cut" (func $post (param i32 i32)))
(memory (export "memory") 1 3)
(global $count (mut i32) (i32.const 0))
(func (export "header_address") (result i32) (i32.const 1024))
(func (export "asyncify_capacity") (result i32) (i32.const 4096))
(func $nested (param $seed i32) (result i32) (local $i i32) (local $sum i32) (local $r i32)
 (local.set $sum (local.get $seed))
 (loop $again
  (global.set $count (i32.add (global.get $count) (i32.const 1)))
  (local.set $r (call $effect (i32.const 9) (i32.const 8) (i32.const 7) (i32.const 6)))
  (local.set $sum (i32.add (i32.mul (local.get $sum) (i32.const 13)) (local.get $r)))
  (i32.store (i32.const 64) (local.get $sum))
  (i32.store (i32.const 68) (global.get $count))
  (call $post (local.get $i) (local.get $sum))
  (local.set $i (i32.add (local.get $i) (i32.const 1)))
  (br_if $again (i32.lt_u (local.get $i) (i32.const 3))))
 (local.get $sum))
(func (export "run") (param $a i32) (result i32)
 (call $pre (i32.const 1) (local.get $a)) (call $nested (local.get $a))))`);try{return Uint8Array.from(m.emitBinary());}finally{m.dispose();}}
const capture=(raw,args=[17],k=key)=>handle({operation:'sequence-capture',moduleBase64:enc(raw),entry:'run',args},{snapshotKey:k});
const advance=(raw,snapshot,response,k=key)=>handle({operation:'sequence-advance',moduleBase64:enc(raw),snapshot,response},{snapshotKey:k});
const importCut=(raw,snapshot,k=other)=>handle({operation:'sequence-import',moduleBase64:enc(raw),snapshot},{snapshotKey:k});

test('repeated identical effects preserve nested loop locals, mutable globals and every sibling history',async()=>{
 const raw=moduleBytes(),root=await capture(raw),rootBytes=JSON.stringify(root.snapshot),seen=[];
 assert.equal(root.snapshot.schema,2);assert.equal(root.summary.decisionCount,0);
 for(const responses of [[1,2,3],[-1,0,2147483647],[0,-2147483648,-1]]){
  let cut=root;
  for(let i=0;i<responses.length;i++){
   const prior=JSON.stringify(cut.snapshot),out=await advance(raw,cut.snapshot,responses[i]);
   assert.equal(JSON.stringify(cut.snapshot),prior);
   assert(out.summary.checks.prefixNotReexecuted);assert(out.summary.checks.pendingArgumentsMatched);
   assert.equal(out.summary.decisionCount,i+1);
   if(i<2){assert.equal(out.summary.status,'captured');assert.equal(out.snapshot.decisions.length,i+1);assert.equal(out.snapshot.bridge.suffix.length,i+1);cut=out;}
   else{assert.equal(out.summary.status,'completed');const ref=runSequenceReference(raw,[17],responses);assert.equal(out.summary.returnI32,ref.returnI32);assert.deepEqual(out.summary.prefix,ref.prefix);assert.deepEqual(out.summary.suffix,ref.suffix);assert.deepEqual(Buffer.from(out.finalMemoryBase64,'base64').subarray(64,72),ref.memory.subarray(64,72));assert.equal(Buffer.from(out.finalMemoryBase64,'base64').readUInt32LE(68),3);seen.push(out);}
  }
 }
 assert.equal(JSON.stringify(root.snapshot),rootBytes);assert.notEqual(seen[0].finalMemoryBase64,seen[1].finalMemoryBase64);
});

test('deep portable cuts independently rebuild the exact declared decision history before resealing',async()=>{
 const raw=moduleBytes(),root=await capture(raw),second=await advance(raw,root.snapshot,8),third=await advance(raw,second.snapshot,-9);
 const imported=await importCut(raw,third.snapshot);assert(imported.summary.importReexecutedPrefix);assert.equal(imported.summary.importReexecutedDecisions,2);assert.notEqual(imported.snapshot.seal,third.snapshot.seal);
 assert.equal((await advance(raw,imported.snapshot,7,other)).summary.returnI32,(await advance(raw,third.snapshot,7)).summary.returnI32);
 const forged=structuredClone(third.snapshot);forged.decisions[0].response++;
 await assert.rejects(importCut(raw,forged),/independently recaptured/);
 await assert.rejects(advance(raw,third.snapshot,1,other),/authentication/);
});

test('sequence shape bounds, history binding and uninterrupted control response count reject invalid work',async()=>{
 const raw=moduleBytes(),root=await capture(raw);
 for(const change of [s=>s.decisions.push({pending:[9,8,7,6],response:1}),s=>s.bridge.suffix.push({stage:0,value:9}),s=>s.extra=true]){const bad=structuredClone(root.snapshot);change(bad);await assert.rejects(advance(raw,bad,1),/authentication|shape/);}
 assert.throws(()=>runSequenceReference(raw,[17],[1,2]),/response/);assert.throws(()=>runSequenceReference(raw,[17],[1,2,3,4]),/unused/);
 await assert.rejects(advance(raw,root.snapshot,2147483648),/i32/);
});
