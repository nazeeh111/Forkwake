import test from 'node:test';import assert from 'node:assert/strict';
import {searchFutures,searchSettings} from '../lib/search.mjs';
const settings={alphabet:[1,0,-1],baseline:[1,1,1],maxDepth:3,maxJobs:128,goal:7};
const root={nodeId:'root',status:'captured',path:[]};
const tree=async(node,r)=>{const path=[...node.path,r],done=path.length===3;return{nodeId:path.join(','),status:done?'completed':'captured',path,summary:{returnI32:done&&path[0]===0&&path[2]===-1?7:0}};};

test('uniform-cost search finds a two-change witness after exhausting every cheaper concrete future',async()=>{
 const calls=[];const report=await searchFutures({root,settings,advance:async(n,r)=>{calls.push([...n.path,r]);return tree(n,r);}});
 assert.equal(report.witnessCost,2);assert(report.minimalWithinBounds);assert.equal(report.matched,1);
 for(const path of [[1,1,1],[0,1,1],[-1,1,1],[1,0,1],[1,-1,1],[1,1,0],[1,1,-1]])assert(calls.some(p=>JSON.stringify(p)===JSON.stringify(path)));
});
test('no-match exhaustion, budget, unresolved cheap truncation and execution errors remain distinct',async()=>{
 const no=await searchFutures({root,settings:{...settings,goal:99},advance:tree});assert(no.exhausted);assert.equal(no.terminals,27);assert.equal(no.executed,39);
 const budget=await searchFutures({root,settings:{...settings,maxJobs:1},advance:tree});assert(budget.budgetLimited);assert(!budget.exhausted);assert(budget.frontier>0);
 const truncated=await searchFutures({root,settings:{...settings,maxDepth:1,baseline:[1]},advance:async(n,r)=>r===1?{nodeId:'pending',status:'captured',path:[r]}:{nodeId:'done',status:'completed',summary:{returnI32:7}}});assert.equal(truncated.witnessCost,1);assert.equal(truncated.depthLimited,1);assert(!truncated.minimalWithinBounds);
 const failed=await searchFutures({root,settings:{...settings,maxDepth:1,baseline:[1]},advance:async(n,r)=>{if(r===1)throw Error('actual execution failed');return {nodeId:'goal',status:'completed',summary:{returnI32:7}};}});assert.equal(failed.failed,1);assert(!failed.minimalWithinBounds);
});
test('cancelled and invalid search requests cannot advertise completion or minimum guarantees',async()=>{
 const controller=new AbortController();controller.abort();const cancelled=await searchFutures({root,settings,advance:tree,signal:controller.signal});assert(cancelled.cancelled);assert(!cancelled.exhausted);assert.equal(cancelled.executed,0);
 for(const change of [{alphabet:[1,1]},{baseline:[2,1,1]},{maxDepth:0},{maxJobs:129},{goal:2147483648}])assert.throws(()=>searchSettings({...settings,...change}));
});

test('cancellation during an awaited advance rejects its late match and retains the search origin',async()=>{
 const controller=new AbortController();
 const report=await searchFutures({root:{...root,path:[8,-9]},settings,signal:controller.signal,advance:async()=>{controller.abort();return {nodeId:'late',status:'completed',summary:{returnI32:7}};}});
 assert(report.cancelled);assert.equal(report.matched,0);assert(!report.minimalWithinBounds);assert(!report.exhausted);assert.equal(report.sourceNodeId,'root');assert.deepEqual(report.sourceResponses,[8,-9]);
});
