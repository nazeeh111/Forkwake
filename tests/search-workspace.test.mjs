import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
import {tinyModule} from './tiny-sequence.mjs';
import {searchWorkspace,encodeSearchWorkspace} from '../lib/search-workspace.mjs';
import {runSequenceReference} from '../lib/runtime.mjs';
const settings={alphabet:[1,-1],baseline:[1,1],maxDepth:2,maxJobs:8,goal:7};
const args=()=>({bytes:tinyModule(),name:'owned-tiny.wasm',input:7,settings});
function seal(value){const {sha256,...body}=value;return {...body,sha256:createHash('sha256').update(encodeSearchWorkspace(body)).digest('hex')};}
function command(argv){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[new URL('../cli.mjs',import.meta.url).pathname,...argv]);let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));});}
test('portable search reconstructs verified handles then resumes exact frontier under fresh budgets',async()=>{
 const options=args(),whole=await searchWorkspace(options);let part=await searchWorkspace({...options,settings:{...settings,maxJobs:1}}),prior;
 assert.equal(part.search.state,'unfinished');assert.equal(part.search.executed,1);
 while(part.search.state==='unfinished'&&part.search.budgetLimited){prior=part.checkpoint;const old=JSON.stringify(prior);part=await searchWorkspace({...options,settings:{...settings,maxJobs:1},prior});assert.equal(JSON.stringify(prior),old);assert.equal(part.search.executed,1);assert.equal(part.actual.validationJobs,prior.nodes.length);}
 assert.deepEqual(part.search.checkpoint,whole.search.checkpoint);
 assert.deepEqual(part.nodes,whole.nodes);
 const witness=part.nodes.find(n=>n.nodeId===part.search.witnessNodeId),control=runSequenceReference(options.bytes,[7],part.search.witnessResponses);
 assert.equal(witness.summary.returnI32,control.returnI32);assert.deepEqual(witness.summary.suffix,control.suffix);assert.equal(part.search.minimalWithinBounds,true);
 await assert.rejects(searchWorkspace({...options,input:8,prior:part.checkpoint}),/Stale/);
 await assert.rejects(searchWorkspace({...options,settings:{...settings,goal:8},prior:part.checkpoint}),/Stale/);
 const changed=Buffer.from(options.bytes);changed[0]^=1;
 await assert.rejects(searchWorkspace({...options,bytes:changed,prior:part.checkpoint}),/Stale/);
 const corrupted=structuredClone(part.checkpoint);corrupted.nodes[1].summary.memorySha256='0'.repeat(64);
 await assert.rejects(searchWorkspace({...options,prior:corrupted}),/digest/);
 await assert.rejects(searchWorkspace({...options,prior:seal(corrupted)}),/independently reconstructed/);
});
test('real CLI process restart exports, opens and resumes without its original source file',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'forkwake-checkpoint-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const module=path.join(base,'tiny.wasm');await fs.writeFile(module,tinyModule());
 const first=path.join(base,'first');let result=await command(['explore','--module',module,'--input','7','--alphabet','1,-1','--baseline','1,1','--max-depth','2','--goal','7','--max-jobs','1','--out',first]);assert.equal(result.code,0,result.stderr);
 const checkpoint=path.join(first,'search.forkwake'),saved=await fs.readFile(checkpoint);await fs.unlink(module);
 const second=path.join(base,'second');result=await command(['explore-resume','--checkpoint',checkpoint,'--max-jobs','8','--out',second]);assert.equal(result.code,0,result.stderr);
 const report=JSON.parse(await fs.readFile(path.join(second,'search.json')));assert.equal(report.search.witnessCost,1);assert.deepEqual(report.search.witnessResponses,[1,-1]);assert(report.search.minimalWithinBounds);assert.equal(report.actual.validationJobs,2);assert.equal(report.search.totalExecuted,report.search.executed+1);
 assert.deepEqual(await fs.readFile(checkpoint),saved);
 for(const filename of await fs.readdir(second)){assert(!filename.endsWith('.pending'));const text=await fs.readFile(path.join(second,filename),'utf8');assert(!text.includes('snapshotKey'));assert(!text.includes('internalPrepared'));assert.equal((await fs.stat(path.join(second,filename))).mode&0o777,0o600);}
 result=await command(['explore-resume','--checkpoint',checkpoint,'--out',second]);assert.notEqual(result.code,0);assert.deepEqual(await fs.readFile(checkpoint),saved);
 const corrupt=path.join(base,'corrupt');await fs.writeFile(corrupt,saved.subarray(0,100));const out=path.join(base,'bad');result=await command(['explore-resume','--checkpoint',corrupt,'--out',out]);assert.notEqual(result.code,0);assert.equal(await fs.stat(out).catch(()=>null),null);
});
