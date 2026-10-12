import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import binaryen from 'binaryen';
import {parseArgs} from '../cli.mjs';
const CLI=fileURLToPath(new URL('../cli.mjs',import.meta.url));
function command(entry,args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[entry,...args],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Sequence CLI test deadline exceeded'));},60000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});});}
const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
function tinyModule(){const m=binaryen.parseText(`(module
 (import "env" "pre_cut" (func $pre (param i32 i32)))
 (import "env" "pending_effect" (func $effect (param i32 i32 i32 i32) (result i32)))
 (import "env" "post_cut" (func $post (param i32 i32)))
 (memory (export "memory") 1 1)
 (func (export "header_address") (result i32) (i32.const 1024))
 (func (export "asyncify_capacity") (result i32) (i32.const 256))
 (func (export "run") (param $input i32) (result i32) (local $first i32) (local $second i32)
  (call $pre (i32.const 1) (local.get $input))
  (local.set $first (call $effect (i32.const 9) (i32.const 8) (i32.const 7) (i32.const 6)))
  (call $post (i32.const 1) (local.get $first))
  (local.set $second (call $effect (i32.const 9) (i32.const 8) (i32.const 7) (i32.const 6)))
  (call $post (i32.const 2) (local.get $second))
  (i32.add (local.get $input) (i32.add (local.get $first) (local.get $second)))))`);try{return Buffer.from(m.emitBinary());}finally{m.dispose();}}
test('sequence CLI parses bounded defaults and rejects mismatched alphabets, baselines and extra flags',()=>{
 const d=parseArgs(['explore','--out','result']);assert.deepEqual(d.settings,{alphabet:[1,0,-1],baseline:[1,1,1,1],maxDepth:4,maxJobs:128,goal:1});assert.equal(d.input,4);
 for(const args of [
  ['explore','--out','x','--alphabet','1,1'],['explore','--out','x','--alphabet','1,2,3,4,5,6'],['explore','--out','x','--baseline','1,1'],['explore','--out','x','--goal','2147483648'],['explore','--out','x','--max-depth','33'],['explore','--out','x','--max-jobs','129'],['explore','--out','x','--max-jobs','01'],['explore','--out','x','--memory'],['continue','--workspace','x','--responses','1'],['continue','--workspace','x','--responses','1,,2','--out','x'],['continue','--workspace','x','--responses',Array(33).fill('1').join(','),'--out','x']
 ])assert.throws(()=>parseArgs(args));
 assert.deepEqual(parseArgs(['explore','--out','x','--alphabet','-1,0','--max-depth','2']).settings.baseline,[-1,-1]);
});
test('installed-style bin explores actual effects, saves/reopens a deep cut and matches an original raw control',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'forkwake-sequence-cli-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const bin=path.join(base,'forkwake');await fs.symlink(CLI,bin);const raw=tinyModule(),module=path.join(base,'tiny.wasm');await fs.writeFile(module,raw);
 const found=path.join(base,'found'),search=await command(bin,['explore','--module',module,'--input','7','--alphabet','1,-1','--baseline','1,1','--max-depth','2','--max-jobs','8','--goal','7','--out',found]);assert.equal(search.code,0,search.stderr);
 const report=await json(path.join(found,'search.json')),nodes=await json(path.join(found,'nodes.json')),root=await json(path.join(found,'workspace.forkwake'));
 assert.equal(report.search.matched,1);assert.equal(report.search.minimalWithinBounds,true);assert.equal(report.search.witnessCost,1);assert.deepEqual(report.search.witnessResponses,[1,-1]);assert.equal(report.witness.summary.returnI32,7);
 assert.equal(root.version,2);assert.equal(root.snapshot.schema,2);assert.deepEqual(root.branches,[]);assert.equal(root.snapshot.decisions.length,0);
 assert.equal(nodes.nodes[0].status,'captured');assert.ok(nodes.nodes.every(n=>!Object.hasOwn(n,'snapshot')&&!Object.hasOwn(n,'finalMemoryBase64')));
 const deep=path.join(base,'deep'),paused=await command(bin,['continue','--workspace',path.join(found,'workspace.forkwake'),'--responses','1','--out',deep]);assert.equal(paused.code,0,paused.stderr);assert.equal(JSON.parse(paused.stdout).status,'captured');const saved=await json(path.join(deep,'workspace.forkwake'));assert.equal(saved.snapshot.decisions.length,1);
 const final=path.join(base,'final'),continued=await command(bin,['continue','--workspace',path.join(deep,'workspace.forkwake'),'--responses','-1','--out',final]);assert.equal(continued.code,0,continued.stderr);const outcomes=await json(path.join(final,'outcomes.json'));assert.equal(outcomes.execution.importReexecutedDecisions,1);assert.equal(outcomes.final.status,'completed');assert.deepEqual(outcomes.final.responses,[1,-1]);assert.equal(await fs.stat(path.join(final,'workspace.forkwake')).catch(()=>null),null);
 const choices=[1,-1],trace=[],original=new WebAssembly.Instance(new WebAssembly.Module(raw),{env:{pre_cut(){},pending_effect(){return choices.shift();},post_cut(stage,value){trace.push({stage:stage>>>0,value:value>>>0});}}});assert.equal(outcomes.final.summary.returnI32,original.exports.run(7));assert.deepEqual(outcomes.final.summary.suffix,trace);
 for(const name of ['search.json','nodes.json','workspace.forkwake']){const text=await fs.readFile(path.join(found,name),'utf8');assert(!text.includes('snapshotKey'));assert(!text.includes('internalPrepared'));assert.equal((await fs.stat(path.join(found,name))).mode&0o777,0o600);}assert.equal((await fs.stat(found)).mode&0o777,0o700);
 const unused=path.join(base,'unused'),rejected=await command(bin,['continue','--workspace',path.join(deep,'workspace.forkwake'),'--responses','-1,0','--out',unused]);assert.notEqual(rejected.code,0);assert.match(rejected.stderr,/Unused responses/);assert.equal(await fs.stat(unused).catch(()=>null),null);
 const edited=structuredClone(saved);edited.branches.push({label:'invented',response:1});const changed=path.join(base,'edited.forkwake');await fs.writeFile(changed,JSON.stringify(edited));const bad=await command(bin,['continue','--workspace',changed,'--responses','1','--out',path.join(base,'bad')]);assert.notEqual(bad.code,0);assert.match(bad.stderr,/empty branches/);
 const repeat=await command(bin,['explore','--module',module,'--out',found]);assert.notEqual(repeat.code,0);assert.match(repeat.stderr,/already exists/);
});
