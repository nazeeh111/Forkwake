import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {searchFutures} from '../lib/search.mjs';
import {searchFutures as baselineSearch} from './search-reference.mjs';
const root={nodeId:'root',status:'captured',path:[]},identity='a'.repeat(64);
const settings={alphabet:[1,0,-1],baseline:[1,1,1],maxDepth:3,maxJobs:128,goal:7};
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
function reseal(c){const {sha256,...body}=c;return {...body,sha256:createHash('sha256').update(canonical(body)).digest('hex')};}
function fixture(seed){const nodes=new Map([['root',root]]),calls=[];return {nodes,calls,advance:async(n,response)=>{
 const path=[...n.path,response];calls.push(path);
 if(seed%4===0&&path.join(',')==='1,0')throw Error('synthetic failed edge');
 const done=path.length===(seed%3===0&&path[0]===-1?2:3),node={nodeId:path.join(','),path,status:done?'completed':'captured',summary:{returnI32:done&&path[0]===0&&path.at(-1)===-1?7:0}};nodes.set(node.nodeId,node);return node;
}};}
test('split invocations preserve exact frozen scheduler order and witnesses across ties and variable depths',async()=>{
 for(let seed=0;seed<30;seed++){
  const a=fixture(seed),b=fixture(seed),s={...settings,goal:seed%5===0?99:7};
  const expected=await baselineSearch({root,settings:s,advance:a.advance});
  let checkpoint,result,invocations=0;
  do{result=await searchFutures({root,settings:{...s,maxJobs:1+seed%4},advance:b.advance,sourceIdentity:identity,checkpoint,resolveNode:id=>b.nodes.get(id)});checkpoint=result.checkpoint;invocations++;assert(invocations<100);}while(result.budgetLimited);
  assert.deepEqual(b.calls,a.calls);
  for(const key of ['witnessResponses','witnessCost','minimalWithinBounds','exhausted','depthLimited','failed','terminals'])assert.deepEqual(result[key],expected[key],key);
  assert.equal(result.totalExecuted,expected.executed);
 }
});
test('cheap unresolved depth and failed edges survive resume and prevent false minimality',async()=>{
 for(const failure of [false,true]){
  const nodes=new Map([['root',root]]),advance=async(n,r)=>{if(r===1&&failure)throw Error('failed');const node={nodeId:String(r),path:[r],status:r===1?'captured':'completed',summary:{returnI32:7}};nodes.set(node.nodeId,node);return node;};
  const s={...settings,maxDepth:1,baseline:[1],maxJobs:1};
  const first=await searchFutures({root,settings:s,advance,sourceIdentity:identity});
  const last=await searchFutures({root,settings:s,advance,sourceIdentity:identity,checkpoint:first.checkpoint,resolveNode:id=>nodes.get(id)});
  assert.equal(last.witnessCost,1);assert.equal(last.minimalWithinBounds,false);assert.deepEqual(last.checkpoint.unresolved,[0]);
 }
});
test('source/settings changes, corruption, duplicate or removed frontier and forged order refuse',async()=>{
 const f=fixture(1),first=await searchFutures({root,settings:{...settings,maxJobs:2},advance:f.advance,sourceIdentity:identity});
 const base={root,settings,advance:f.advance,sourceIdentity:identity,checkpoint:first.checkpoint,resolveNode:id=>f.nodes.get(id)};
 await assert.rejects(searchFutures({...base,sourceIdentity:'b'.repeat(64)}),/Stale/);
 await assert.rejects(searchFutures({...base,settings:{...settings,goal:9}}),/Stale/);
 for(const change of [c=>c.frontier.push(c.frontier[0]),c=>c.frontier.pop(),c=>c.unresolved.push(0),c=>c.history[0].serial++,c=>c.frontier[0].cost++]){
  const changed=structuredClone(first.checkpoint);change(changed);
  await assert.rejects(searchFutures({...base,checkpoint:changed}),/digest|bounds/i);
  await assert.rejects(searchFutures({...base,checkpoint:reseal(changed)}),/coverage|order/i);
 }
 await assert.rejects(searchFutures({...base,resolveNode:()=>undefined}),/missing validated node/);
});
test('cancelled in-flight edge remains pending and can resume instead of losing cheaper work',async()=>{
 const f=fixture(1),controller=new AbortController();
 const paused=await searchFutures({root,settings,sourceIdentity:identity,signal:controller.signal,advance:async()=>{controller.abort();throw Error('cancelled')}});
 assert.equal(paused.executed,1);assert.equal(paused.frontier,3);assert.equal(paused.state,'unfinished');
 const result=await searchFutures({root,settings,sourceIdentity:identity,checkpoint:paused.checkpoint,resolveNode:id=>f.nodes.get(id),advance:f.advance});
 assert.equal(result.minimalWithinBounds,true);assert.equal(result.totalExecuted,result.executed+1);
});
