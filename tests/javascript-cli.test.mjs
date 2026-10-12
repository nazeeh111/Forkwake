import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {parseArgs} from '../cli.mjs';
const CLI=fileURLToPath(new URL('../cli.mjs',import.meta.url));
const source=`let visits=0;
const lines=[];
function log(text){lines.push(text);emit(lines.join('\\n'));}
log('entry:'+(++visits)+':seed:'+seed);
log('marker:雪');
const reserved=decision('reserve',{quantity:4});
log('reserve:'+reserved);
const paid=decision('payment',{total:120});
log('payment:'+paid);
globalThis.resultI32=reserved===1&&paid===-1?1:0;
`;
function command(entry,args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[entry,...args],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('JavaScript CLI test exceeded bounded preparation/execution time'));},125000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});});}
const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
async function temporary(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'forkwake-javascript-cli-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return base;}
test('JavaScript CLI defaults seed1, keeps module defaults and rejects conflicting source options',()=>{
 const capture=parseArgs(['capture','--script','workflow.js','--out','new']);assert.equal(capture.input,1);assert.equal(capture.script,path.resolve('workflow.js'));
 const script=parseArgs(['explore','--script','workflow.js','--out','new']);assert.equal(script.input,1);assert.equal(script.module,undefined);
 assert.equal(parseArgs(['explore','--out','new']).input,4);assert.equal(parseArgs(['explore','--module','guest.wasm','--out','new']).input,4);
 for(const args of [['capture','--out','new'],['capture','--script','a.js'],['capture','--module','a.wasm','--out','new'],['capture','--script','a.js','--input','2147483648','--out','new'],['explore','--script','a.js','--module','a.wasm','--out','new'],['capture','--script','a.js','--script','b.js','--out','new']])assert.throws(()=>parseArgs(args));
});
test('actual installed-style JavaScript capture, deep continuation and minimal search match a V8 control',async t=>{
 const base=await temporary(t),bin=path.join(base,'forkwake');await fs.symlink(CLI,bin);
 const file=path.join(base,'workflow.js');await fs.writeFile(file,source);
 const captured=path.join(base,'captured'),run=await command(bin,['capture','--script',file,'--out',captured]);assert.equal(run.code,0,run.stderr);
 const workspace=await json(path.join(captured,'workspace.forkwake')),nodes=await json(path.join(captured,'nodes.json'));
 assert.equal(workspace.version,2);assert.deepEqual(workspace.branches,[]);assert.deepEqual(workspace.settings.args,[1]);assert.equal(nodes.nodes.length,1);assert.equal(nodes.nodes[0].report.kind,'javascript');assert.equal(nodes.nodes[0].report.status,'pending');assert.equal(nodes.nodes[0].report.pendingLabel,'reserve');assert.equal(nodes.nodes[0].report.entryCount,1);assert.match(nodes.nodes[0].report.output,/entry:1:seed:1/);
 assert.equal(nodes.execution.script.sourceSha256,createHash('sha256').update(source).digest('hex'));
 assert.equal(await fs.stat(path.join(captured,'search.json')).catch(()=>null),null);
 await fs.unlink(file); // Portable module bytes carry the source; no compiler/source file is needed now.
 const deep=path.join(base,'deep'),advanced=await command(bin,['continue','--workspace',path.join(captured,'workspace.forkwake'),'--responses','1','--out',deep]);assert.equal(advanced.code,0,advanced.stderr);
 const deepOut=await json(path.join(deep,'outcomes.json'));assert.equal(deepOut.final.report.status,'pending');assert.equal(deepOut.final.report.pendingLabel,'payment');assert.deepEqual(deepOut.final.report.pendingPayload,{total:120});assert.equal(deepOut.final.report.pendingPayloadJson,'{"total":120}');assert.equal(deepOut.final.report.entryCount,1);
 const final=path.join(base,'final'),completed=await command(bin,['continue','--workspace',path.join(deep,'workspace.forkwake'),'--responses','-1','--out',final]);assert.equal(completed.code,0,completed.stderr);
 const out=await json(path.join(final,'outcomes.json'));assert.equal(out.execution.importReexecutedDecisions,1);assert.equal(out.final.report.status,'completed');assert.equal(out.final.report.resultI32,1);assert.equal(out.final.report.entryCount,1);assert.equal((out.final.report.output.match(/entry:/g)||[]).length,1);
 const expected=[],choices=[1,-1],context={seed:1,decision(){return choices.shift();},emit(text){expected.push(text);}};vm.runInNewContext(source,context);assert.equal(out.final.report.resultI32,context.resultI32);assert.equal(out.final.summary.returnI32,context.resultI32);assert.equal(out.final.report.output,expected.at(-1));
 await fs.writeFile(file,source);const searchDir=path.join(base,'search'),searched=await command(bin,['explore','--script',file,'--alphabet','1,-1','--baseline','1,1','--goal','1','--max-depth','2','--max-jobs','8','--out',searchDir]);assert.equal(searched.code,0,searched.stderr);
 const search=await json(path.join(searchDir,'search.json'));assert.equal(search.search.matched,1);assert.equal(search.search.minimalWithinBounds,true);assert.equal(search.search.witnessCost,1);assert.deepEqual(search.search.witnessResponses,[1,-1]);assert.equal(search.witness.report.resultI32,1);assert.equal(search.witness.report.entryCount,1);
 for(const directory of [captured,deep,final,searchDir])for(const name of await fs.readdir(directory)){const text=await fs.readFile(path.join(directory,name),'utf8');assert(!text.includes('snapshotKey'));assert(!text.includes('internalPrepared'));assert.equal((await fs.stat(path.join(directory,name))).mode&0o777,0o600);}
 const preserve=path.join(base,'preserve');await fs.mkdir(preserve);await fs.writeFile(path.join(preserve,'sentinel'),'keep');const rejected=await command(bin,['capture','--script',file,'--out',preserve]);assert.notEqual(rejected.code,0);assert.match(rejected.stderr,/already exists/);assert.equal(await fs.readFile(path.join(preserve,'sentinel'),'utf8'),'keep');assert.deepEqual(await fs.readdir(preserve),['sentinel']);
});
test('bounded UTF-8 sources reject before output creation and JavaScript exceptions never become goal matches',async t=>{
 const base=await temporary(t),file=path.join(base,'source.js');
 for(const [name,bytes]of [['invalid',Buffer.from([0xc3,0x28])],['empty',Buffer.alloc(0)],['nul',Buffer.from('decision("x","y");\0')]]){await fs.writeFile(file,bytes);const out=path.join(base,name),run=await command(CLI,['capture','--script',file,'--out',out]);assert.notEqual(run.code,0);assert.equal(await fs.stat(out).catch(()=>null),null);}
 const huge=await fs.open(file,'w');await huge.truncate(1024*1024+1);await huge.close();const limited=await command(CLI,['capture','--script',file,'--out',path.join(base,'huge')]);assert.notEqual(limited.code,0);assert.match(limited.stderr,/at most 1048576 bytes/);
 await fs.writeFile(file,'decision("gate","{}"); throw new Error("intentional-cli-error");');
 const out=path.join(base,'error-search'),run=await command(CLI,['explore','--script',file,'--alphabet','1','--baseline','1','--goal','0','--max-depth','1','--max-jobs','1','--out',out]);assert.equal(run.code,0,run.stderr);const report=await json(path.join(out,'search.json'));assert.equal(report.search.matched,0);assert.equal(report.search.failed,1);assert.equal(report.search.minimalWithinBounds,false);assert.match(report.search.errors[0].message,/intentional-cli-error/);
});
