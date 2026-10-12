import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {createServer} from '../server.mjs';
import {handle,runSequenceReference} from '../lib/runtime.mjs';
import {reportFulfillmentFromMemory,FULFILLMENT_SHA} from '../lib/fulfillment-fixture.mjs';
const raw=await fs.readFile(new URL('../examples/fulfillment/workflow.raw.wasm',import.meta.url));
const moduleBase64=raw.toString('base64'),key='53'.repeat(32),trusted={snapshotKey:key};

test('every sequential SQLite terminal matches original C/SQLite results, full query rows and complete history',async()=>{
 let leaves=0,cuts=0;
 for(const qty of [4,-4]){
  const root=await handle({operation:'sequence-capture',moduleBase64,entry:'run',args:[qty]},trusted),todo=[root];
  trusted.trustedPrepared=root.internalPrepared;
  while(todo.length){const current=todo.shift();cuts++;const before=JSON.stringify(current.snapshot);
   for(const response of [1,0,-1]){
    const out=await handle({operation:'sequence-advance',moduleBase64,snapshot:current.snapshot,response},trusted);
    assert.equal(JSON.stringify(current.snapshot),before);
    assert(out.summary.checks.historyNotReexecuted);
    if(out.snapshot){assert(out.snapshot.decisions.length<4);todo.push(out);}
    else{leaves++;const choices=out.summary.decisions.map(d=>d.response),control=runSequenceReference(raw,[qty],choices);assert.equal(out.summary.returnI32,control.returnI32);assert.deepEqual(out.summary.prefix,control.prefix);assert.deepEqual(out.summary.suffix,control.suffix);assert.deepEqual(out.summary.decisions,control.decisions);assert.deepEqual(reportFulfillmentFromMemory(FULFILLMENT_SHA,out.finalMemoryBase64),reportFulfillmentFromMemory(FULFILLMENT_SHA,control.memory.toString('base64')));}
   }
  }
 }
 assert.equal(leaves,24);assert.equal(cuts,11);
});

test('HTTP tree search, deep persistence, actual comparisons and corrected-policy exhaustion compose',async()=>{
 const app=await createServer({port:0});
 try{
  const bootstrap=await (await fetch(app.origin+'/api/bootstrap')).json();
  const post=async(path,data)=>{const r=await fetch(app.origin+path,{method:'POST',headers:{origin:app.origin,'x-forkwake-token':bootstrap.token,'content-type':'application/json'},body:JSON.stringify(data)});return {status:r.status,value:await r.json()};};
  const get=async path=>(await fetch(app.origin+path)).json();
  const finish=async queued=>{assert.equal(queued.status,202);const started=Date.now();for(;;){const j=await get('/api/jobs/'+queued.value.job);if(j.state==='done')return j.result;if(j.state!=='running')throw Error(j.error??j.state);if(Date.now()-started>180000)throw Error('Integration observation deadline');await new Promise(r=>setTimeout(r,25));}};
  const m=(await post('/api/sequence-demo',{})).value;
  const original=await finish(await post('/api/sequence-jobs',{operation:'capture',moduleId:m.id,entry:'run',args:[4]}));
  const search=await finish(await post('/api/sequence-jobs',{operation:'search',sessionId:original.sessionId,nodeId:original.rootNodeId,alphabet:[1,0,-1],baseline:[1,1,1,1],maxDepth:4,maxJobs:128,goal:1}));
  assert(search.searchReport.minimalWithinBounds);assert.equal(search.searchReport.witnessCost,2);assert.deepEqual(search.searchReport.witnessResponses,[1,-1,-1,1]);
  const witness=search.nodes.find(n=>n.nodeId===search.searchReport.witnessNodeId),parent=search.nodes.find(n=>n.nodeId===witness.parentId);assert.equal(witness.summary.returnI32,1);assert.equal(witness.report.finished,true);assert.equal(witness.report.policy,'deliberately faulty');
  const exported=await get('/api/sequence-workspaces/'+search.sessionId+'?node='+parent.nodeId);assert.equal(exported.version,2);assert.equal(exported.snapshot.decisions.length,3);assert(!JSON.stringify(exported).includes('snapshotKey'));assert.deepEqual(exported.branches,[]);
  const imported=await finish(await post('/api/sequence-jobs',{operation:'import',workspace:exported}));assert.equal(imported.nodes[0].summary.importReexecutedDecisions,3);assert.deepEqual(imported.nodes[0].path,[1,-1,-1]);
  const resumed=await finish(await post('/api/sequence-jobs',{operation:'advance',sessionId:imported.sessionId,nodeId:imported.rootNodeId,response:1,label:'Verified imported failure'}));assert.equal(resumed.nodes.at(-1).summary.returnI32,1);assert.deepEqual(resumed.nodes.at(-1).report,witness.report);
  const fixed=await finish(await post('/api/sequence-jobs',{operation:'capture',moduleId:m.id,entry:'run',args:[-4]}));
  const fixedSearch=await finish(await post('/api/sequence-jobs',{operation:'search',sessionId:fixed.sessionId,nodeId:fixed.rootNodeId,alphabet:[1,0,-1],baseline:[1,1,1,1],maxDepth:4,maxJobs:128,goal:1}));assert(fixedSearch.searchReport.exhausted,JSON.stringify(fixedSearch.searchReport));assert.equal(fixedSearch.searchReport.terminals,11);assert.equal(fixedSearch.searchReport.matched,0);assert(fixedSearch.nodes.every(n=>n.status!=='completed'||n.summary.returnI32===0));
  const budget=await finish(await post('/api/sequence-jobs',{operation:'search',sessionId:fixed.sessionId,nodeId:fixed.rootNodeId,alphabet:[1,0,-1],baseline:[1,1,1,1],maxDepth:4,maxJobs:1,goal:1}));assert(budget.searchReport.budgetLimited);assert(!budget.searchReport.exhausted);assert.equal(budget.searchReport.reused,1);
  const bytes=await get('/api/sequence-memory?session='+search.sessionId+'&node='+witness.nodeId+'&offset=0&length=128');assert.equal(bytes.hex.length,256);
  const compare=await get('/api/sequence-compare?session='+search.sessionId+'&left='+witness.nodeId+'&right='+parent.nodeId);assert(compare.diff.changedBytes>0);
  assert.equal((await post('/api/sequence-jobs',{operation:'capture',moduleId:m.id,entry:'run',args:[2147483648]})).status,400);
  assert.equal((await post('/api/sequence-jobs',{operation:'advance',sessionId:fixed.sessionId,nodeId:witness.nodeId,response:1,label:'Foreign'})).status,400);
  const forged=structuredClone(exported);forged.snapshot.decisions[0].response=0;const failed=await post('/api/sequence-jobs',{operation:'import',workspace:forged});assert.equal(failed.status,202);for(;;){const j=await get('/api/jobs/'+failed.value.job);if(j.state!=='running'){assert.equal(j.state,'error');assert.match(j.error,/independently recaptured/);break;}await new Promise(r=>setTimeout(r,25));}
 }finally{await app.close();}
});
