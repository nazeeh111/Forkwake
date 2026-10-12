import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';

async function finish(origin,id){const until=Date.now()+35000;while(Date.now()<until){const r=await(await fetch(origin+'/api/jobs/'+id)).json();if(r.state!=='running'){assert.equal(r.state,'done',r.error);return r.result;}await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Owned job did not finish');}

test('actual HTTP capture, sibling outcomes, exact comparison and validated durable import',async()=>{
 const app=await createServer({port:0});
 try{
  const {token}=await(await fetch(app.origin+'/api/bootstrap')).json();
  const post=async(path,body)=>{const r=await fetch(app.origin+path,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Forkwake-Token':token},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.ok,true,data.error);return data;};
  const unauthorized=await fetch(app.origin+'/api/demo',{method:'POST',headers:{Origin:'http://other.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(unauthorized.status,403);
  const module=await post('/api/demo',{});
  const begun=await post('/api/jobs',{operation:'capture',moduleId:module.id,entry:'run',args:[4]});
  const cut=await finish(app.origin,begun.job);assert.deepEqual(cut.settings,{entry:'run',args:[4]});assert.equal(cut.isBundledExample,true);assert.equal(cut.summary.continuationBytes,484);assert.equal(cut.summary.memoryBytes,4194304);
  const outcomes=[];
  for(const response of [1,0,-1]){const job=await post('/api/jobs',{operation:'fork',sessionId:cut.sessionId,response,label:String(response)});outcomes.push(await finish(app.origin,job.job));}
  assert.deepEqual(outcomes.map(b=>b.report.orders),[3,2,2]);assert.deepEqual(outcomes.map(b=>b.report.receiptTotal),[120,0,0]);
  assert.deepEqual(outcomes[1].report.rows.attempts,['denied']);assert.deepEqual(outcomes[2].report.rows.attempts,['timeout']);
  for(const b of outcomes){assert.equal(b.report.sqlCallbackEntries,1);assert.equal(b.report.paymentStatementBusyInsideEffect,1);assert.equal(b.report.autocommitInsideEffect,0);assert.equal(b.summary.checks.prefixNotReexecuted,true);}
  const comparison=await(await fetch(app.origin+'/api/compare?left='+outcomes[0].branchId+'&right='+outcomes[1].branchId)).json();assert(comparison.diff.changedBytes>0);assert(comparison.reportChanges.some(c=>c.key==='orders'&&c.left===3&&c.right===2));
  const memory=await(await fetch(app.origin+'/api/memory?session='+cut.sessionId+'&branch='+outcomes[0].branchId+'&offset=711856&length=88')).json();assert.equal(memory.hex.slice(0,8),'01000000');assert.equal(memory.totalBytes,4194304);
  const workspace=await(await fetch(app.origin+'/api/workspaces/'+cut.sessionId)).json();assert.equal(workspace.branches.length,3);assert(!JSON.stringify(workspace).includes('internalPrepared'));assert(!JSON.stringify(workspace).includes('snapshotKey'));
  const imported=await post('/api/jobs',{operation:'import',workspace});const restored=await finish(app.origin,imported.job);assert.equal(restored.summary.importReexecutedPrefix,true);assert.deepEqual(restored.savedBranches,workspace.branches);
  const bad=structuredClone(workspace);bad.snapshot.args=[5];const settingsMismatch=await fetch(app.origin+'/api/jobs',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Forkwake-Token':token},body:JSON.stringify({operation:'import',workspace:bad})});assert.equal(settingsMismatch.status,400);assert.match((await settingsMismatch.json()).error,/settings differ/);bad.settings.args=[5];const rejected=await post('/api/jobs',{operation:'import',workspace:bad});
  let rejectedState;for(let i=0;i<350;i++){rejectedState=await(await fetch(app.origin+'/api/jobs/'+rejected.job)).json();if(rejectedState.state!=='running')break;await new Promise(r=>setTimeout(r,100));}assert.equal(rejectedState.state,'error');
  console.log('HTTP actualSQLite outcomes/control identities verified; imported data independently recaptured, forged cut rejected.');
 }finally{await app.close();}
});

test('cancel targets a confirmed real running worker and accepts no result afterward',async()=>{
 const app=await createServer({port:0});try{
  const {token}=await(await fetch(app.origin+'/api/bootstrap')).json();
  const post=async(path,value)=>await(await fetch(app.origin+path,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Forkwake-Token':token},body:JSON.stringify(value)})).json();
  const module=await post('/api/demo',{});const {job}=await post('/api/jobs',{operation:'capture',moduleId:module.id,entry:'run',args:[4]});
  const running=await(await fetch(app.origin+'/api/jobs/'+job)).json();assert.equal(running.state,'running');
  await post('/api/cancel/'+job,{});await new Promise(r=>setTimeout(r,100));const cancelled=await(await fetch(app.origin+'/api/jobs/'+job)).json();assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.result,undefined);
 }finally{await app.close();}
});
