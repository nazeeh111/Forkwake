import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {tinyModule} from './tiny-sequence.mjs';
import {main} from '../cli.mjs';
const CLI=new URL('../cli.mjs',import.meta.url).pathname;
const args=(module,out)=>['explore','--module',module,'--input','7','--alphabet','1,0,-1','--baseline','1,1','--max-depth','2','--goal','999','--out',out];
function command(argv){const child=spawn(process.execPath,[CLI,...argv]);let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);return {child,done:new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));})};}
test('actual SIGINT after captured root publishes an unfinished checkpoint and restart exhausts same finite tree',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'forkwake-interrupt-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const module=path.join(base,'tiny.wasm'),out=path.join(base,'pause');await fs.writeFile(module,tinyModule());
 const running=command(args(module,out));t.after(()=>{if(running.child.exitCode===null)running.child.kill('SIGKILL');});
 const deadline=Date.now()+20000;for(;;){try{JSON.parse(await fs.readFile(path.join(out,'workspace.forkwake'),'utf8'));break;}catch{if(Date.now()>deadline)throw Error('Root did not become available');await new Promise(r=>setTimeout(r,5));}}
 running.child.kill('SIGINT');const stopped=await running.done;assert.equal(stopped.code,130,stopped.stderr);
 const prior=path.join(out,'search.forkwake'),saved=await fs.readFile(prior),report=JSON.parse(await fs.readFile(path.join(out,'search.json')));assert(report.search.cancelled);assert.equal(report.search.state,'unfinished');assert.equal(report.search.matched,0);
 const resumed=path.join(base,'resumed'),result=await command(['explore-resume','--checkpoint',prior,'--max-jobs','128','--out',resumed]).done;assert.equal(result.code,0,result.stderr);
 const final=JSON.parse(await fs.readFile(path.join(resumed,'search.json')));assert(final.search.exhausted);assert.equal(final.search.terminals,9);assert.equal(final.search.failed,0);assert.deepEqual(await fs.readFile(prior),saved);
});
test('late partial checkpoint write never publishes a final and does not replace earlier valid work',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'forkwake-output-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const module=path.join(base,'tiny.wasm'),out=path.join(base,'failed');await fs.writeFile(module,tinyModule());
 const open=fs.open;
 fs.open=async(...arguments_)=>{const handle=await open(...arguments_);if(String(arguments_[0]).endsWith('.pending'))handle.writeFile=async()=>{await handle.write('partial');throw Error('injected late checkpoint failure');};return handle;};
 try{await assert.rejects(main([...args(module,out),'--max-jobs','1']),/injected late/);}finally{fs.open=open;}
 assert.equal(await fs.stat(path.join(out,'search.forkwake')).catch(()=>null),null);assert.equal((await fs.readdir(out)).some(name=>name.endsWith('.pending')),false);
 const retry=path.join(base,'retry'),result=await command([...args(module,retry),'--max-jobs','1']).done;assert.equal(result.code,0,result.stderr);
 const saved=await fs.readFile(path.join(retry,'search.forkwake'));const refusal=await command([...args(module,retry),'--max-jobs','1']).done;assert.notEqual(refusal.code,0);assert.deepEqual(await fs.readFile(path.join(retry,'search.forkwake')),saved);
});

test('exclusive staging collision preserves bytes this invocation did not create',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'forkwake-collision-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const module=path.join(base,'tiny.wasm'),out=path.join(base,'out');await fs.writeFile(module,tinyModule());
 const open=fs.open;let foreign;
 fs.open=async(...arguments_)=>{if(String(arguments_[0]).endsWith('.pending')){foreign=arguments_[0];const handle=await open(foreign,'wx',0o600);await handle.writeFile('unrelated synthetic bytes');await handle.close();}return open(...arguments_);};
 try{await assert.rejects(main([...args(module,out),'--max-jobs','1']),{code:'EEXIST'});}finally{fs.open=open;}
 assert.equal(await fs.readFile(foreign,'utf8'),'unrelated synthetic bytes');assert.equal(await fs.stat(path.join(out,'search.forkwake')).catch(()=>null),null);
});
