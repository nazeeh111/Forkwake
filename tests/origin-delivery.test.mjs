import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseArgs} from '../cli.mjs';
import {createServer} from '../server.mjs';

const CLI=fileURLToPath(new URL('../cli.mjs',import.meta.url));
const DEMO=fileURLToPath(new URL('../examples/javascript/origin-example.js',import.meta.url));
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
function command(args){return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[CLI,...args],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Origin CLI exceeded preparation/execution boundary'));},125000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
});}

test('Origin is explicitly opt-in and cannot be silently requested for a raw module',()=>{
  assert.equal(parseArgs(['capture','--script','x.js','--out','new']).origin,undefined);
  assert.equal(parseArgs(['capture','--script','x.js','--origin','--out','new']).origin,true);
  assert.equal(parseArgs(['explore','--script','x.js','--origin','--out','new']).origin,true);
  for(const args of [['explore','--origin','--out','new'],['explore','--module','x.wasm','--origin','--out','new'],['capture','--script','x.js','--origin','--origin','--out','new']])assert.throws(()=>parseArgs(args));
});

test('real traced CLI cut reopens under a new private key without the source file and preserves last decision context',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'forkwake-origin-delivery-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const source=path.join(temp,'checkout.js');await fs.copyFile(DEMO,source);
  const start=path.join(temp,'start');let run=await command(['capture','--script',source,'--origin','--out',start]);assert.equal(run.code,0,run.stderr);
  let nodes=await read(path.join(start,'nodes.json'));let report=nodes.nodes[0].report;
  assert.equal(report.pendingLabel,'inventory');assert.equal(report.origin.state,'captured');assert.equal(report.origin.lastDecision,false);
  assert.ok(report.origin.frames.some(f=>f.functionName==='checkout'&&f.sourceBound));
  await fs.unlink(source);
  const retry=path.join(temp,'retry');run=await command(['continue','--workspace',path.join(start,'workspace.forkwake'),'--responses','1,-1','--out',retry]);assert.equal(run.code,0,run.stderr);
  report=(await read(path.join(retry,'outcomes.json'))).final.report;
  assert.equal(report.pendingLabel,'payment');assert.ok(report.origin.frames.some(f=>f.functionName==='paymentAttempt'&&f.sourceBound));
  const dispatch=path.join(temp,'dispatch');run=await command(['continue','--workspace',path.join(retry,'workspace.forkwake'),'--responses','-1','--out',dispatch]);assert.equal(run.code,0,run.stderr);
  report=(await read(path.join(dispatch,'outcomes.json'))).final.report;
  assert.equal(report.pendingLabel,'dispatch');assert.ok(report.origin.frames.some(f=>f.functionName==='dispatchOrder'&&f.sourceBound));
  const ending=path.join(temp,'ending');run=await command(['continue','--workspace',path.join(dispatch,'workspace.forkwake'),'--responses','1','--out',ending]);assert.equal(run.code,0,run.stderr);
  report=(await read(path.join(ending,'outcomes.json'))).final.report;
  assert.equal(report.resultI32,1);assert.equal(report.origin.lastDecision,true);assert.equal(report.origin.pendingOrdinal,4);
  assert.deepEqual(JSON.parse(report.output),{reserved:true,paid:false,dispatched:true,attempts:[{label:'inventory',reply:1},{label:'payment',reply:-1},{label:'payment',reply:-1},{label:'dispatch',reply:1}]});
});

test('HTTP source loading keeps legacy requests valid, rejects mistyped tracing, and supplies the actual Origin example',async t=>{
  const app=await createServer({port:0,prepareDeadlineMs:90000,deadlineMs:30000});t.after(()=>app.close());const url=app.origin;
  const token=(await(await fetch(url+'/api/bootstrap')).json()).token;
  const post=async data=>{const r=await fetch(url+'/api/sequence-script',{method:'POST',headers:{'content-type':'application/json','x-forkwake-token':token,origin:url},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
  const source='globalThis.resultI32=decision("one",{});';
  const old=await post({source,name:'old.js'});assert.equal(old.status,200);assert.equal(old.data.script.originTracing,false);
  const traced=await post({source,name:'new.js',origin:true});assert.equal(traced.status,200);assert.equal(traced.data.script.originTracing,true);assert.notEqual(old.data.id,traced.data.id);
  for(const origin of [1,'true',null,{},[]])assert.equal((await post({source,name:'bad.js',origin})).status,400);
  const example=await(await fetch(url+'/api/sequence-script-example?policy=origin')).json();assert.equal(example.origin,true);assert.equal(example.source,await fs.readFile(DEMO,'utf8'));
});
