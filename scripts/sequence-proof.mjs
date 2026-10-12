import fs from 'node:fs/promises';import assert from 'node:assert/strict';
import {handle,runSequenceReference} from '../lib/runtime.mjs';
import {searchFutures} from '../lib/search.mjs';
import {FULFILLMENT_SHA,reportFulfillmentFromMemory} from '../lib/fulfillment-fixture.mjs';
const raw=await fs.readFile(new URL('../examples/fulfillment/workflow.raw.wasm',import.meta.url)),moduleBase64=raw.toString('base64');
const key='64'.repeat(32),options={snapshotKey:key};
const proof={moduleSha256:FULFILLMENT_SHA,cases:[]};
for(const input of [4,-4]){
 const r=await handle({operation:'sequence-capture',moduleBase64,entry:'run',args:[input]},options);options.trustedPrepared=r.internalPrepared;
 let serial=0;const nodes=[{...r,nodeId:String(serial++),status:'captured'}];
 const report=await searchFutures({root:nodes[0],settings:{alphabet:[1,0,-1],baseline:[1,1,1,1],maxDepth:4,maxJobs:128,goal:1},advance:async(parent,response)=>{
  const n=await handle({operation:'sequence-advance',moduleBase64,snapshot:parent.snapshot,response},options);const node={...n,nodeId:String(serial++),status:n.summary.status};nodes.push(node);
  if(!n.snapshot){const ref=runSequenceReference(raw,[input],n.summary.decisions.map(d=>d.response));assert.equal(n.summary.returnI32,ref.returnI32);assert.deepEqual(reportFulfillmentFromMemory(FULFILLMENT_SHA,n.finalMemoryBase64),reportFulfillmentFromMemory(FULFILLMENT_SHA,ref.memory.toString('base64')));assert.deepEqual(n.summary.suffix,ref.suffix);}
  return node;
 }});
 if(input===4){assert.equal(report.witnessCost,2);assert(report.minimalWithinBounds);assert.deepEqual(report.witnessResponses,[1,-1,-1,1]);}else{assert(report.exhausted);assert.equal(report.terminals,11);}
 proof.cases.push({input,report,nodes:nodes.map(n=>({nodeId:n.nodeId,status:n.status,summary:n.summary,report:reportFulfillmentFromMemory(FULFILLMENT_SHA,n.snapshot?.memoryBase64??n.finalMemoryBase64)}))});
}
console.log(JSON.stringify(proof,null,2));
