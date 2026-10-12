import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import binaryen from 'binaryen';
import {parseArgs,workerJob} from '../cli.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url)),CLI=path.join(ROOT,'cli.mjs'),SMALL=path.join(ROOT,'examples/continuation/fixture.raw.wasm');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function temporary(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'forkwake-cli-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
function command(args,{timeout=60000,entry=CLI}={}){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[entry,...args],{cwd:ROOT,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('CLI test deadline exceeded'));},timeout);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stdout,stderr});});});}
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
function reference(raw,input,response){const prefix=[],suffix=[];const module=new WebAssembly.Module(raw),instance=new WebAssembly.Instance(module,{env:{pre_cut(stage,value){prefix.push({stage:stage>>>0,value:value>>>0});},post_cut(stage,value){suffix.push({stage:stage>>>0,value:value>>>0});},pending_effect(){return response;}}});const value=instance.exports.run(input);return{module,instance,value:value>>>0,prefix,suffix};}
function inspectFinal(module,memory){const instance=new WebAssembly.Instance(module,{env:{pre_cut(){throw Error('Unexpected inspector effect');},post_cut(){throw Error('Unexpected inspector effect');},pending_effect(){throw Error('Unexpected inspector effect');}}});new Uint8Array(instance.exports.memory.buffer).set(memory);const e=instance.exports;return{entries:e.entry_count()>>>0,allocated:e.allocated_words()>>>0,global:e.global_value()>>>0,heap:[...new Uint32Array(e.memory.buffer,e.arena_address()>>>0,4)]};}

test('installed-style bin symlink prints help and executes a real compiled continuation',async t=>{
 const base=await temporary(t),binDirectory=path.join(base,'node_modules','.bin');await fs.mkdir(binDirectory,{recursive:true});const bin=path.join(binDirectory,'forkwake');await fs.symlink(CLI,bin,'file');
 const help=await command(['--help'],{entry:bin});assert.equal(help.code,0,help.stderr);assert.match(help.stdout,/Forkwake: fork one paused/);
 const out=path.join(base,'result'),run=await command(['run','--module',SMALL,'--input','37','--responses','9','--out',out],{entry:bin});assert.equal(run.code,0,run.stderr);assert.equal(JSON.parse(run.stdout).branches,1);const outcomes=await readJson(path.join(out,'outcomes.json')),raw=await fs.readFile(SMALL),control=reference(raw,37,9);assert.equal(outcomes.branches[0].summary.returnU32,control.value);assert.deepEqual(outcomes.branches[0].summary.suffix,control.suffix);assert.equal(outcomes.branches[0].summary.checks.prefixNotReexecuted,true);
 const wrapper=path.join(base,'import-only.mjs');await fs.writeFile(wrapper,`import ${JSON.stringify(new URL('../cli.mjs',import.meta.url).href)};\nconsole.log('import-only');\n`);const imported=await command(['--help'],{entry:wrapper});assert.equal(imported.code,0,imported.stderr);assert.equal(imported.stdout,'import-only\n');
});

test('CLI capture and portable resume match independently executed real compiled C controls',async t=>{
 const base=await temporary(t),out=path.join(base,'captured');const result=await command(['run','--module',SMALL,'--input','37','--responses','1,9,-1','--out',out,'--memory']);assert.equal(result.code,0,result.stderr);
 const workspace=await readJson(path.join(out,'workspace.forkwake')),outcomes=await readJson(path.join(out,'outcomes.json'));
 assert.deepEqual(Object.keys(workspace),['schema','version','module','snapshot','settings','branches']);assert.equal(workspace.schema,'forkwake.workspace');assert.equal(workspace.version,1);assert.deepEqual(workspace.settings,{entry:'run',args:[37]});
 assert.equal(workspace.branches.length,3);assert.equal(outcomes.capture.prefix.length,3);assert.equal(outcomes.execution.prefixIndependentlyReexecutedForImport,false);assert.equal(outcomes.execution.branchPrefixReexecuted,false);assert.equal(outcomes.execution.preparationDeadlineMs,90000);assert.equal(outcomes.execution.workerDeadlineMs,30000);assert.equal(outcomes.execution.transformPolicy,'closed-wasm32-pure-accessors-v2');
 assert(!JSON.stringify(workspace).includes('internalPrepared'));assert(!JSON.stringify(workspace).includes('snapshotKey'));assert(!JSON.stringify(outcomes).includes('sessionKey'));
 const raw=await fs.readFile(SMALL);assert.equal(workspace.module.sha256,sha(raw));
 for(const branch of outcomes.branches){const control=reference(raw,37,branch.response),memory=await fs.readFile(path.join(out,branch.memoryFile));assert.equal(memory.length,branch.summary.memoryBytes);assert.equal(sha(memory),branch.summary.memorySha256);assert.equal(branch.summary.returnU32,control.value);assert.deepEqual(branch.summary.prefix,control.prefix);assert.deepEqual(branch.summary.suffix,control.suffix);assert.deepEqual(inspectFinal(control.module,memory),inspectFinal(control.module,Buffer.from(control.instance.exports.memory.buffer)));assert.equal(branch.summary.checks.prefixNotReexecuted,true);assert.equal(branch.report,undefined);}
 const resumed=path.join(base,'resumed');const resume=await command(['resume','--workspace',path.join(out,'workspace.forkwake'),'--responses','9,1','--out',resumed]);assert.equal(resume.code,0,resume.stderr);const again=await readJson(path.join(resumed,'outcomes.json')),newWorkspace=await readJson(path.join(resumed,'workspace.forkwake'));
 assert.equal(again.capture.importReexecutedPrefix,true);assert.equal(again.execution.prefixIndependentlyReexecutedForImport,true);assert.equal(again.execution.branchPrefixReexecuted,false);assert.equal(newWorkspace.snapshot.memorySha256,workspace.snapshot.memorySha256);assert.notEqual(newWorkspace.snapshot.seal,workspace.snapshot.seal);assert.equal(again.branches[0].summary.returnU32,outcomes.branches[1].summary.returnU32);assert.deepEqual(again.branches[0].summary.suffix,outcomes.branches[1].summary.suffix);assert(!again.branches[0].memoryFile);
 const changed=structuredClone(workspace);const altered=Buffer.from(changed.snapshot.memoryBase64,'base64');altered[changed.snapshot.continuation.header+8]^=1;changed.snapshot.memoryBase64=altered.toString('base64');await fs.writeFile(path.join(base,'changed.forkwake'),JSON.stringify(changed));const rejected=await command(['resume','--workspace',path.join(base,'changed.forkwake'),'--responses','1','--out',path.join(base,'rejected')]);assert.notEqual(rejected.code,0);assert.match(rejected.stderr,/integrity|match|header|continuation/);assert.equal(await fs.stat(path.join(base,'rejected')).catch(()=>null),null);
});

test('CLI keeps existing output bytes, rejects strict arguments and bounds input files',async t=>{
 const base=await temporary(t),out=path.join(base,'existing');await fs.mkdir(out);await fs.writeFile(path.join(out,'sentinel.txt'),'preserve me');
 const existing=await command(['run','--module',SMALL,'--input','0','--responses','1','--out',out]);assert.notEqual(existing.code,0);assert.match(existing.stderr,/already exists/);assert.equal(await fs.readFile(path.join(out,'sentinel.txt'),'utf8'),'preserve me');assert.deepEqual(await fs.readdir(out),['sentinel.txt']);
 for(const argv of [['bad'],['serve','--port','-1'],['serve','--port','65536'],['serve','--out','x'],['demo','--out','x','--out','y'],['run','--module','x','--input','2147483648','--responses','1','--out','x'],['run','--module','x','--input','1.0','--responses','1','--out','x'],['run','--module','x','--input','0','--responses','1,,2','--out','x'],['run','--module','x','--input','0','--responses','1, 2','--out','x'],['run','--module','x','--input','0','--responses',Array(13).fill('1').join(','),'--out','x'],['resume','--workspace','x','--responses','1'],['demo','--out','x','--unknown']])assert.throws(()=>parseArgs(argv));
 assert.equal(parseArgs(['run','--module','x','--input','-2147483648','--responses','2147483647,-2147483648','--out','x']).input,-2147483648);
 const huge=path.join(base,'huge.wasm'),handle=await fs.open(huge,'wx');await handle.truncate(8*1024*1024+1);await handle.close();const limited=await command(['run','--module',huge,'--input','0','--responses','1','--out',path.join(base,'limited')]);assert.notEqual(limited.code,0);assert.match(limited.stderr,/at most 8388608 bytes/);assert.equal(await fs.stat(path.join(base,'limited')).catch(()=>null),null);
 const help=await command(['--help']);assert.equal(help.code,0);assert.match(help.stdout,/independently re-executes/);assert.match(help.stdout,/One pending cut/);
});

test('worker deadlines and cancellation terminate actual nonreturning forks; later siblings still work',async()=>{
 const module=binaryen.parseText(`(module
  (import "env" "pre_cut" (func $pre (param i32 i32)))
  (import "env" "pending_effect" (func $effect (param i32 i32 i32 i32) (result i32)))
  (import "env" "post_cut" (func $post (param i32 i32)))
  (memory (export "memory") 1 1)
  (func (export "header_address") (result i32) (i32.const 1024))
  (func (export "asyncify_capacity") (result i32) (i32.const 256))
  (func (export "run") (param $input i32) (result i32) (local $answer i32)
   (call $pre (i32.const 1) (local.get $input))
   (local.set $answer (call $effect (i32.const 1) (local.get $input) (i32.const 0) (i32.const 0)))
   (if (i32.eqz (local.get $answer)) (then (loop $forever (br $forever))))
   (call $post (i32.const 1) (local.get $answer)) (local.get $answer)))`);
 let moduleBase64;try{moduleBase64=Buffer.from(module.emitBinary()).toString('base64');}finally{module.dispose();}
 const snapshotKey=randomBytes(32).toString('hex'),captured=await workerJob({operation:'capture',moduleBase64,entry:'run',args:[7]},{snapshotKey});const request=response=>({operation:'fork',moduleBase64,snapshot:captured.snapshot,response});
 let rejectedPhases=0;await assert.rejects(workerJob({operation:'capture',moduleBase64,entry:'wrong',args:[7]},{snapshotKey,onExecution(){rejectedPhases++;}}),/ABI requires run\(i32\)/);assert.equal(rejectedPhases,0);
 let timeoutPhases=0;await assert.rejects(workerJob(request(0),{snapshotKey,trustedPrepared:captured.internalPrepared,deadlineMs:500,onExecution(){timeoutPhases++;}}),/Worker execution exceeded the 500-millisecond deadline/);assert.equal(timeoutPhases,1);
 const controller=new AbortController();let cancelPhases=0,timer;const pending=workerJob(request(0),{snapshotKey,trustedPrepared:captured.internalPrepared,signal:controller.signal,onExecution(){cancelPhases++;timer=setTimeout(()=>controller.abort(),200);}});try{await assert.rejects(pending,/Interrupted.*terminated/);assert.equal(cancelPhases,1);}finally{clearTimeout(timer);}
 const resumed=await workerJob(request(9),{snapshotKey,trustedPrepared:captured.internalPrepared});assert.equal(resumed.summary.returnI32,9);assert.equal(resumed.summary.checks.prefixNotReexecuted,true);
});

test('CLI demo reports actual SQLite rows and preserves the executing SQL callback once',async t=>{
 const base=await temporary(t),out=path.join(base,'sqlite');const run=await command(['demo','--out',out],{timeout:4*(90000+30000)+5000});assert.equal(run.code,0,run.stderr);const report=await readJson(path.join(out,'outcomes.json'));assert.equal(report.capture.continuationBytes,484);assert.equal(report.capture.memoryBytes,4194304);
 assert.deepEqual(report.branches.map(b=>b.report.orders),[3,2,2]);assert.deepEqual(report.branches.map(b=>b.report.receiptTotal),[120,0,0]);assert.deepEqual(report.branches[1].report.rows.attempts,['denied']);assert.deepEqual(report.branches[2].report.rows.attempts,['timeout']);for(const b of report.branches){assert.equal(b.report.sqlCallbackEntries,1);assert.equal(b.report.paymentStatementBusyInsideEffect,1);assert.equal(b.report.autocommitInsideEffect,0);assert.equal(b.summary.checks.prefixNotReexecuted,true);}
});

test('CLI serve binds its actual local server and exits on a signal',async t=>{
 const child=spawn(process.execPath,[CLI,'serve','--port','0'],{cwd:ROOT,stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 const exited=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));const until=Date.now()+10000;while(!output.includes('Open ')&&Date.now()<until&&child.exitCode===null)await new Promise(resolve=>setTimeout(resolve,25));assert.match(output,/Open http:\/\/127\.0\.0\.1:\d+/,error);
 const origin=output.match(/Open (http:\/\/127\.0\.0\.1:\d+)/)[1];const response=await fetch(origin+'/api/bootstrap');assert.equal(response.status,200);assert.equal((await response.json()).version,'0.1.0');child.kill('SIGTERM');const stopped=await exited;assert.equal(stopped.code,143,error);
});
