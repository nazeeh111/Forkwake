import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';

test('one bounded server supports the faulty and corrected JavaScript journeys without losing coverage', {timeout:180000},async t=>{
 const app=await createServer({port:0});t.after(()=>app.close());const origin=app.origin;
 async function get(path){const response=await fetch(origin+path);const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
 const boot=await get('/api/bootstrap');
 async function post(path,value){const response=await fetch(origin+path,{method:'POST',headers:{origin,'x-forkwake-token':boot.token,'content-type':'application/json'},body:JSON.stringify(value)});const body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body;}
 async function job(value){const started=await post('/api/sequence-jobs',value),end=Date.now()+110000;while(Date.now()<end){const j=await get('/api/jobs/'+started.job);if(j.state==='done')return j.result;if(j.state!=='running')throw Error(j.error||j.state);await new Promise(resolve=>setTimeout(resolve,30));}throw Error('Bounded test job did not finish');}
 const evidence=[];
 for(const policy of ['faulty','corrected']){
  const example=await get('/api/sequence-script-example?policy='+policy),module=await post('/api/sequence-script',example);assert.equal(module.script.source,example.source);
  const captured=await job({operation:'capture',moduleId:module.id,entry:'run',args:[1]});assert.equal(captured.nodes[0].report.pendingLabel,'Reserve funds');
  const result=await job({operation:'search',sessionId:captured.sessionId,nodeId:captured.rootNodeId,alphabet:[1,0,-1],baseline:[1,1,1,1],maxDepth:4,maxJobs:128,goal:1}),report=result.searchReport;
  assert.equal(report.failed,0);assert.equal(report.matched,policy==='faulty'?1:0);
  if(policy==='faulty'){assert.equal(report.witnessCost,2);assert.equal(report.minimalWithinBounds,true);assert.deepEqual(report.witnessResponses,[1,-1,-1,1]);}
  else{assert.equal(report.exhausted,true);assert.equal(report.terminals,17);assert.equal(report.frontier,0);}
  assert(result.nodes.every(n=>n.report.entryCount===1));evidence.push({policy,executed:report.executed,terminals:report.terminals,failed:report.failed,exhausted:report.exhausted});
 }
 console.log('Actual same-server JavaScript coverage:',JSON.stringify(evidence));
});
