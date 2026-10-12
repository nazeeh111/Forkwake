import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {FULFILLMENT_SHA,FULFILLMENT_FIELDS,reportFulfillmentFromMemory,fulfillmentEffectName} from '../lib/fulfillment-fixture.mjs';
const bytes=readFileSync(new URL('../examples/fulfillment/workflow.raw.wasm',import.meta.url));
const module=new WebAssembly.Module(bytes);
function control(input,responses){
  let instance,index=0;const prefix=[],suffix=[],cuts=[];
  instance=new WebAssembly.Instance(module,{env:{
    pre_cut(stage,value){prefix.push({stage,value});},
    post_cut(stage,value){suffix.push({stage,value});},
    pending_effect(...pending){
      assert.ok(index<responses.length,'control response sequence exhausted');
      const report=reportFulfillmentFromMemory(FULFILLMENT_SHA,Buffer.from(instance.exports.memory.buffer).toString('base64'));
      cuts.push({pending,report});return responses[index++];
    }
  }});
  instance.exports._initialize?.();
  const returned=instance.exports.run(input);
  const memory=Buffer.from(instance.exports.memory.buffer).toString('base64');
  return {returned,responses:responses.slice(0,index),prefix,suffix,cuts,memory,report:reportFulfillmentFromMemory(FULFILLMENT_SHA,memory)};
}
test('fulfillment raw source hash and exact closed imports bind the report decoder',()=>{
  assert.equal(createHash('sha256').update(bytes).digest('hex'),FULFILLMENT_SHA);
  assert.deepEqual(WebAssembly.Module.imports(module).map(x=>`${x.module}.${x.name}`).sort(),['env.pending_effect','env.post_cut','env.pre_cut']);
  assert.equal(FULFILLMENT_FIELDS.length,32);
  assert.equal(reportFulfillmentFromMemory('0'.repeat(64),''),undefined);
  assert.throws(()=>reportFulfillmentFromMemory(FULFILLMENT_SHA,Buffer.alloc(32).toString('base64')),/bounds/);
  assert.equal(fulfillmentEffectName(904),'Retry payment');
  const instance=new WebAssembly.Instance(module,{env:{pre_cut(){throw Error('unexpected initialization callback');},post_cut(){throw Error('unexpected initialization callback');},pending_effect(){throw Error('unexpected initialization callback');}}});
  instance.exports._initialize?.();assert.equal(instance.exports.memory.buffer.byteLength,4194304);
  assert.throws(()=>instance.exports.memory.grow(1),RangeError);
  assert.equal(instance.exports.header_address()%4,0);assert.equal(instance.exports.asyncify_capacity(),524296);
});
test('all24 distinct SQL paths have live transaction, nested locals, busy statements and actual invariant result',()=>{
  const paths=new Map();
  for(const input of [4,-4])for(let n=0;n<81;n++){
    let code=n;const responses=[];for(let i=0;i<4;i++){responses.push([-1,0,1][code%3]);code=Math.floor(code/3);}
    const c=control(input,responses),key=`${input}:${c.responses}`;if(paths.has(key))continue;paths.set(key,c);
    assert.deepEqual(c.prefix.map(p=>p.stage),[1,2,3,4]);
    assert.equal(c.report.entryCount,1);assert.equal(c.report.callbackEntries,c.responses.length);
    assert.equal(c.report.cursorSum,6);assert.equal(c.report.cursorCount,3);
    assert.equal(c.report.forbiddenFiles,0);assert.equal(c.report.autocommitAfter,1);assert.equal(c.report.finished,true);
    assert.equal(c.report.sqlCallbackLocalBefore,c.report.sqlCallbackLocalAfter);
    assert.equal(c.report.correctedPolicy,input<0?1:0);
    assert.equal(c.report.rows.attempts.length,c.responses.length);
    assert.deepEqual(c.report.rows.attempts.map(a=>a.response),c.responses);
    assert.deepEqual(c.report.rows.attempts.map(a=>a.effect),c.cuts.map(cut=>cut.pending[0]));
    const violation=c.report.rows.shipments.some(s=>s.status==='shipped'&&!c.report.rows.receipts.some(r=>r.orderId===s.orderId));
    assert.equal(c.returned,violation?1:0);assert.equal(c.report.violatedShipWithoutReceipt,violation?1:0);
    assert.equal(violation,input===4&&JSON.stringify(c.responses)==='[1,-1,-1,1]');
    for(const [i,cut]of c.cuts.entries()){
      assert.equal(cut.report.autocommitInsideEffect,0);assert.equal(cut.report.cursorBusyInsideEffect,1);assert.equal(cut.report.decisionStatementBusyInsideEffect,1);
      assert.equal(cut.report.sqlCallbackEntriesAtCut,i+1);assert.equal(cut.report.entryCount,1);assert.equal(cut.report.correctedPolicy,input<0?1:0);
      assert.equal(cut.report.forbiddenFilesAtCut,0);assert.equal(cut.report.finished,false);assert.ok(cut.report.sqliteMemoryBytesAtCut>0);
    }
  }
  assert.equal([...paths.keys()].filter(k=>k.startsWith('4:')).length,13);
  assert.equal([...paths.keys()].filter(k=>k.startsWith('-4:')).length,11);
});
test('successful receipt, exhausted timeout defect and corrected early termination are actual SQL states',()=>{
  const success=control(4,[1,1,1]);assert.equal(success.returned,0);
  assert.deepEqual(success.report.rows.receipts,[{orderId:3,total:120}]);assert.deepEqual(success.report.rows.shipments,[{orderId:3,status:'shipped'}]);assert.equal(success.report.rows.inventory[0].stock,8);
  const faulty=control(4,[1,-1,-1,1]);assert.equal(faulty.returned,1);assert.deepEqual(faulty.report.rows.receipts,[]);assert.equal(faulty.report.rows.orders[0].status,'shipped');
  const fixed=control(-4,[1,-1,-1,1]);assert.equal(fixed.returned,0);assert.equal(fixed.responses.length,3);assert.deepEqual(fixed.report.rows.shipments,[]);assert.equal(fixed.report.rows.orders[0].status,'payment-timeout');assert.equal(fixed.report.rows.inventory[0].stock,12);assert.equal(fixed.report.rows.inventory[0].reserved,0);
});
test('real stock rejection terminates before payment; invalid quantity traps',()=>{
  const stock=control(13,[1,1,1]);assert.equal(stock.responses.length,1);assert.equal(stock.report.rows.orders[0].status,'out-of-stock');assert.equal(stock.report.rows.inventory[0].stock,12);
  for(const input of [0,-2147483648,1000001,-1000001])assert.throws(()=>control(input,[]),WebAssembly.RuntimeError);
});
