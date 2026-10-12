#!/usr/bin/env node
import fs from 'node:fs/promises';
import {constants as FS} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {reportFromMemory} from './lib/fixture.mjs';
import {reportFulfillmentFromMemory} from './lib/fulfillment-fixture.mjs';
import {executeJob} from './lib/jobs.mjs';
import {searchFutures,searchSettings} from './lib/search.mjs';

const ROOT=new URL('./',import.meta.url),MODULE_BYTES=8*1024*1024,WORKSPACE_BYTES=64*1024*1024,MEMORY_BYTES=32*1024*1024;
const DEADLINE_MS=30000,PREPARATION_DEADLINE_MS=90000,MAX_BRANCHES=12,POLICY='closed-wasm32-pure-accessors-v2';
const MAX_SEQUENCE=32,MAX_NODES=64,RETAINED_MEMORY_BYTES=128*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const help=`Forkwake: branch live, owned WebAssembly continuations\n\nUsage:\n  forkwake serve [--port 6350]\n  forkwake demo --out <new directory> [--memory]\n  forkwake run --module <wasm> --input <signed i32> --responses <comma-separated signed i32s> --out <new directory> [--memory]\n  forkwake resume --workspace <workspace.forkwake> --responses <comma-separated signed i32s> --out <new directory> [--memory]\n\nOutputs: workspace.forkwake and outcomes.json. --memory also writes actual final-memory binaries. Existing output directories are refused.\n\nThe guest ABI is run(i32)->i32, header_address()->i32, asyncify_capacity()->i32, an owned bounded wasm32 memory, and exact owned env effect imports. The original demo/run/resume operations support one pending cut; explore/continue support sequential effects. Native processes, files, network connections and threads are not cloned.\n\nPortable resume independently re-executes and validates the original prefix once. Its subsequent sibling branches resume the validated cut without replaying that prefix. Validation and transformation have a 90-second preparation deadline; guest execution has a separate 30-second deadline.\n`;
const sequenceHelp=`\nSequential effects:\n  forkwake explore [--module <wasm>] [--input 4] [--alphabet 1,0,-1] [--baseline 1,1,1,1] [--goal 1] [--max-depth 4] [--max-jobs 128] --out <new directory>\n  forkwake continue --workspace <version-2 workspace.forkwake> --responses <comma-separated signed i32s> --out <new directory>\n\nExplore defaults to the compiled SQLite fulfillment example. Positive quantity selects its deliberately faulty policy; negative quantity selects the corrected policy. The search prioritizes fewer changes from the supplied baseline. Bounds are one to five distinct choices, 32 additional decisions, 128 edge attempts, 64 retained node records and 128MiB of retained guest memory. No unbounded correctness claim is made.\n\nExplore writes the root workspace.forkwake, search.json and nodes.json. Continue independently re-executes and verifies every declared earlier decision before resuming; it writes outcomes.json and, if still paused, a deep workspace.forkwake. Every supplied response must be consumed. Version-1 resume remains the original sibling-branch command. Output files contain actual guest memory or reports and should remain private when guest data is private.\n`;
function exact(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw Error(`Invalid ${label} fields`);}
function i32Text(text,label){if(typeof text!=='string'||!/^(?:0|-[1-9][0-9]{0,9}|[1-9][0-9]{0,9})$/.test(text))throw Error(`${label} must be a decimal signed i32`);const value=Number(text);if(!Number.isInteger(value)||value< -2147483648||value>2147483647)throw Error(`${label} is outside the signed i32 range`);return value;}
function responses(text){const parts=text.split(',');if(!parts.length||parts.length>MAX_BRANCHES)throw Error(`Choose between one and ${MAX_BRANCHES} responses`);return parts.map(part=>i32Text(part,'Response'));}
function sequenceResponses(text,maximum=MAX_SEQUENCE){const parts=text.split(',');if(!parts.length||parts.length>maximum)throw Error(`Choose between one and ${maximum} responses`);return parts.map(part=>i32Text(part,'Response'));}
function positiveText(text,label,maximum){if(!/^[1-9][0-9]{0,2}$/.test(text)||Number(text)>maximum)throw Error(`${label} must be an integer from 1 to ${maximum}`);return Number(text);}
export function parseArgs(argv){
 if(!Array.isArray(argv)||argv.some(arg=>typeof arg!=='string'))throw Error('Arguments must be strings');
 if(!argv.length||argv.length===1&&['help','--help','-h'].includes(argv[0]))return {command:'help'};
 const [command,...rest]=argv;if(!['serve','demo','run','resume','explore','continue'].includes(command))throw Error(`Unknown command: ${command}`);
 if(rest.length===1&&['--help','-h'].includes(rest[0]))return {command:'help'};
 const allowed={serve:['--port'],demo:['--out','--memory'],run:['--module','--input','--responses','--out','--memory'],resume:['--workspace','--responses','--out','--memory'],explore:['--module','--input','--alphabet','--baseline','--goal','--max-depth','--max-jobs','--out'],continue:['--workspace','--responses','--out']}[command];
 const flags={};for(let index=0;index<rest.length;index++){
  const name=rest[index];if(!allowed.includes(name))throw Error(`Unknown ${command} option: ${name}`);if(Object.hasOwn(flags,name))throw Error(`Duplicate option: ${name}`);
  if(name==='--memory'){flags[name]=true;continue;}
  const value=rest[++index];if(value===undefined||value===''||value.startsWith('--'))throw Error(`Missing value for ${name}`);flags[name]=value;
 }
 if(command==='serve'){const raw=flags['--port']??'6350';if(!/^(?:0|[1-9][0-9]{0,4})$/.test(raw)||Number(raw)>65535)throw Error('Port must be an integer from 0 to 65535');return {command,port:Number(raw)};}
 if(command==='explore'){
  if(!Object.hasOwn(flags,'--out'))throw Error('Missing required option: --out');
  const alphabet=sequenceResponses(flags['--alphabet']??'1,0,-1',5),maxDepth=positiveText(flags['--max-depth']??'4','Maximum depth',MAX_SEQUENCE);
  const settings=searchSettings({alphabet,baseline:flags['--baseline']===undefined?Array(maxDepth).fill(alphabet[0]):sequenceResponses(flags['--baseline']),maxDepth,maxJobs:positiveText(flags['--max-jobs']??'128','Maximum jobs',128),goal:i32Text(flags['--goal']??'1','Goal')});
  return {command,out:path.resolve(flags['--out']),module:flags['--module']===undefined?fileURLToPath(new URL('examples/fulfillment/workflow.raw.wasm',ROOT)):path.resolve(flags['--module']),input:i32Text(flags['--input']??'4','Input'),settings};
 }
 if(command==='continue'){
  for(const name of ['--workspace','--responses','--out'])if(!Object.hasOwn(flags,name))throw Error(`Missing required option: ${name}`);
  return {command,out:path.resolve(flags['--out']),workspace:path.resolve(flags['--workspace']),responses:sequenceResponses(flags['--responses'])};
 }
 const required=command==='run'?['--module','--input','--responses','--out']:command==='resume'?['--workspace','--responses','--out']:['--out'];
 for(const name of required)if(!Object.hasOwn(flags,name))throw Error(`Missing required option: ${name}`);
 return {command,out:path.resolve(flags['--out']),memory:flags['--memory']===true,
  ...(command==='demo'?{input:4,responses:[1,0,-1]}:{responses:responses(flags['--responses'])}),
  ...(command==='run'?{module:path.resolve(flags['--module']),input:i32Text(flags['--input'],'Input')}:{}),
  ...(command==='resume'?{workspace:path.resolve(flags['--workspace'])}:{})};
}
async function readBounded(filename,maximum,label){
 const handle=await fs.open(filename,FS.O_RDONLY|FS.O_NONBLOCK);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>maximum)throw Error(`${label} must be a regular file of at most ${maximum} bytes`);
  const chunks=[];let total=0;while(true){const buffer=Buffer.allocUnsafe(Math.min(65536,maximum-total+1));const {bytesRead}=await handle.read(buffer);if(!bytesRead)break;total+=bytesRead;if(total>maximum)throw Error(`${label} exceeds its byte limit`);chunks.push(buffer.subarray(0,bytesRead));}return Buffer.concat(chunks,total);
 }finally{await handle.close();}
}
function decode(value,max,label){if(typeof value!=='string'||value.length>Math.ceil(max/3)*4||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error(`Invalid bounded ${label}`);const bytes=Buffer.from(value,'base64');if(!bytes.length||bytes.length>max||bytes.toString('base64')!==value)throw Error(`Invalid canonical ${label}`);return bytes;}
function validateWorkspace(workspace,version=1){
 exact(workspace,['schema','version','module','snapshot','settings','branches'],'workspace');if(workspace.schema!=='forkwake.workspace'||workspace.version!==version)throw Error('Unsupported workspace version');
 exact(workspace.module,['name','sha256','dataBase64'],'workspace module');const m=workspace.module;if(typeof m.name!=='string'||m.name.length>256||typeof m.sha256!=='string'||!/^[a-f0-9]{64}$/.test(m.sha256))throw Error('Invalid saved module identity');
 const bytes=decode(m.dataBase64,MODULE_BYTES,'module bytes');if(sha(bytes)!==m.sha256)throw Error('Saved module digest does not match its bytes');
 exact(workspace.settings,['entry','args'],'workspace settings');const s=workspace.settings;
 if(s.entry!=='run'||!Array.isArray(s.args)||s.args.length!==1||!Number.isInteger(s.args[0])||s.args[0]<-2147483648||s.args[0]>2147483647)throw Error('Saved settings require run(i32)');
 if(!workspace.snapshot||workspace.snapshot.entry!==s.entry||JSON.stringify(workspace.snapshot.args)!==JSON.stringify(s.args))throw Error('Saved settings differ from the captured entry arguments');
 if(!Array.isArray(workspace.branches)||workspace.branches.length>MAX_BRANCHES)throw Error('Too many saved branches');
 if(version===2&&(workspace.branches.length!==0||workspace.snapshot?.schema!==2))throw Error('Sequence workspace requires a sequence cut and empty branches');
 for(const branch of workspace.branches){exact(branch,['label','response'],'saved branch');if(typeof branch.label!=='string'||branch.label.length>64||!Number.isInteger(branch.response)||branch.response< -2147483648||branch.response>2147483647)throw Error('Invalid saved branch');}
 return bytes;
}
/** Trusted owner configuration stays outside guest request/workspace JSON. */
export function workerJob(request,{snapshotKey,trustedPrepared,signal,deadlineMs=DEADLINE_MS,prepareDeadlineMs=PREPARATION_DEADLINE_MS,onExecution}={}){
 if(signal?.aborted)return Promise.reject(Error('Interrupted before the worker started'));
 if(!Number.isInteger(deadlineMs)||deadlineMs<1||deadlineMs>2147483647||!Number.isInteger(prepareDeadlineMs)||prepareDeadlineMs<1||prepareDeadlineMs>2147483647)return Promise.reject(Error('Worker deadlines must be positive bounded integer milliseconds'));
 if(onExecution!==undefined&&typeof onExecution!=='function')return Promise.reject(Error('Execution observer must be a trusted owner callback'));
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('lib/worker.mjs',ROOT),{workerData:{request,snapshotKey,trustedPrepared},resourceLimits:{maxOldGenerationSizeMb:384,maxYoungGenerationSizeMb:64,stackSizeMb:8}});
  let done=false,phase='preparation',timer;
  const finish=async(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);await worker.terminate();if(error)reject(error);else resolve(result);};
  const abort=()=>{void finish(Error('Interrupted; active worker terminated'));};
  const arm=(milliseconds,label)=>{clearTimeout(timer);const duration=milliseconds%1000===0?`${milliseconds/1000}-second`:`${milliseconds}-millisecond`;timer=setTimeout(()=>{void finish(Error(`Worker ${label} exceeded the ${duration} deadline; no outcome accepted`));},milliseconds);};
  arm(prepareDeadlineMs,'preparation');
  signal?.addEventListener('abort',abort,{once:true});
  worker.on('message',packet=>{
   if(done)return;
   try{
    if(packet&&Object.hasOwn(packet,'phase')){
     exact(packet,['phase'],'worker phase');if(packet.phase!=='execution'||phase!=='preparation')throw Error('Unexpected or duplicate worker execution phase');
     phase='execution';arm(deadlineMs,'execution');onExecution?.();return;
    }
    if(packet?.ok===false){exact(packet,['ok','error'],'worker failure');if(typeof packet.error!=='string')throw Error('Invalid worker failure');void finish(Error(packet.error.slice(0,2048)||'Guest job failed'));return;}
    exact(packet,['ok','result'],'worker result');if(packet.ok!==true||phase!=='execution')throw Error('Worker result arrived without a verified execution phase');void finish(null,packet.result);
   }catch(error){void finish(error);}
  });
  worker.once('error',error=>{void finish(error);});worker.once('exit',()=>{if(!done)void finish(Error('Worker exited without an accepted result'));});
 });
}
function cache(result){const prepared=result.internalPrepared;if(!prepared||prepared.metadata?.version!==2||prepared.metadata.validationPolicy!==POLICY)throw Error('Worker did not return the current validated transform cache');return prepared;}
async function writeNew(filename,bytes,signal){if(signal?.aborted)throw Error('Interrupted before writing output');await fs.writeFile(filename,bytes,{flag:'wx',mode:0o600,signal});}
async function createOutput(directory){try{await fs.mkdir(directory,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw Error('Output directory already exists; choose a new directory');throw error;}}
function actualReport(digest,memory){return reportFulfillmentFromMemory(digest,memory)??reportFromMemory(digest,memory);}
function publicNode(result,{nodeId,parentId=null,response=null,additionalResponses=[]},digest){
 const report=actualReport(digest,result.snapshot?.memoryBase64??result.finalMemoryBase64);
 return {nodeId,parentId,response,additionalResponses:[...additionalResponses],responses:result.summary.decisions.map(d=>d.response),status:result.snapshot?'captured':'completed',summary:result.summary,...(report?{report}:{})};
}
async function saveSequenceWorkspace(directory,{name,digest,moduleBase64,snapshot},signal){
 const workspace={schema:'forkwake.workspace',version:2,module:{name,sha256:digest,dataBase64:moduleBase64},snapshot,settings:{entry:snapshot.entry,args:snapshot.args},branches:[]};
 const encoded=JSON.stringify(workspace,null,2)+'\n';if(Buffer.byteLength(encoded)>WORKSPACE_BYTES)throw Error('Workspace exceeds the 64MiB export limit');
 await writeNew(path.join(directory,'workspace.forkwake'),encoded,signal);
}
async function writeJsonNew(filename,value,signal){const encoded=JSON.stringify(value,null,2)+'\n';if(Buffer.byteLength(encoded)>16*1024*1024)throw Error('Sequence report exceeds its 16MiB export limit');await writeNew(filename,encoded,signal);}
async function executeSequence(options,signal){
 let original,bytes,name;
 if(options.command==='continue'){
  try{original=JSON.parse((await readBounded(options.workspace,WORKSPACE_BYTES,'Workspace')).toString('utf8'));}catch(error){if(error instanceof SyntaxError)throw Error('Workspace is not valid JSON');throw error;}
  bytes=validateWorkspace(original,2);name=original.module.name;
 }else{bytes=await readBounded(options.module,MODULE_BYTES,'Module');name=path.basename(options.module);if(name.length>256)throw Error('Module name is too long');}
 const digest=sha(bytes),moduleBase64=bytes.toString('base64'),snapshotKey=randomBytes(32).toString('hex');
 await createOutput(options.out);let complete=false;
 try{
  let captured=await executeJob(original?{operation:'sequence-import',moduleBase64,snapshot:original.snapshot}:{operation:'sequence-capture',moduleBase64,entry:'run',args:[options.input]},{snapshotKey,signal,prepareDeadlineMs:PREPARATION_DEADLINE_MS,deadlineMs:DEADLINE_MS});
  const prepared=cache(captured),root=publicNode(captured,{nodeId:'n0'},digest),execution={prefixIndependentlyReexecutedForImport:original!==undefined,importReexecutedDecisions:captured.summary.importReexecutedDecisions??0,branchPrefixReexecuted:false,preparationDeadlineMs:PREPARATION_DEADLINE_MS,workerDeadlineMs:DEADLINE_MS,transformPolicy:POLICY};
  original=undefined;
  if(options.command==='continue'){
   const steps=[];let current=captured.snapshot;captured=null;
   for(let index=0;index<options.responses.length;index++){
    if(!current)throw Error('Unused responses remain after the guest completed');
    const response=options.responses[index],result=await executeJob({operation:'sequence-advance',moduleBase64,snapshot:current,response},{snapshotKey,trustedPrepared:prepared,signal,prepareDeadlineMs:PREPARATION_DEADLINE_MS,deadlineMs:DEADLINE_MS});
    steps.push(publicNode(result,{nodeId:`n${index+1}`,parentId:index?`n${index}`:'n0',response,additionalResponses:options.responses.slice(0,index+1)},digest));current=result.snapshot;
   }
   const final=steps.at(-1);
   if(current)await saveSequenceWorkspace(options.out,{name,digest,moduleBase64,snapshot:current},signal);
   await writeJsonNew(path.join(options.out,'outcomes.json'),{schema:'forkwake.sequence-outcomes',version:1,operation:'continue',module:{name,sha256:digest},execution,imported:root,providedResponses:options.responses,steps,final,scope:'Actual resumed sequence. Deep import independently validates earlier declared decisions; only subsequent decisions resume without prefix replay.'},signal);
   complete=true;return {directory:options.out,status:final.status,outcomes:'outcomes.json',...(current?{workspace:'workspace.forkwake'}:{}),consumedResponses:steps.length,importReexecutedDecisions:execution.importReexecutedDecisions};
  }
  await saveSequenceWorkspace(options.out,{name,digest,moduleBase64,snapshot:captured.snapshot},signal);
  const snapshots=new Map([['n0',captured.snapshot]]),nodes=[root],edges=new Map(),remaining=new Map([['n0',options.settings.alphabet.length]]);
  let retainedBytes=captured.summary.memoryBytes,peakRetainedBytes=retainedBytes,workerJobs=1;captured=null;
  if(retainedBytes>RETAINED_MEMORY_BYTES)throw Error('Root continuation exceeds the retained memory limit');
  const release=id=>{const snapshot=snapshots.get(id);if(snapshot){retainedBytes-=Buffer.byteLength(snapshot.memoryBase64,'base64');snapshots.delete(id);}};
  const search=await searchFutures({root,settings:options.settings,signal,advance:async(parent,response)=>{
   const edgeKey=`${parent.nodeId}:${response}`;if(edges.has(edgeKey))return {...edges.get(edgeKey),reused:true};
   if(nodes.length>=MAX_NODES)throw Error('The 64-node retention limit prevents this edge; search coverage is incomplete');
   const snapshot=snapshots.get(parent.nodeId);if(!snapshot)throw Error('Paused parent continuation is no longer retained');
   const parentMemoryBytes=Buffer.byteLength(snapshot.memoryBase64,'base64');
   if(retainedBytes+parentMemoryBytes>RETAINED_MEMORY_BYTES)throw Error('The 128MiB retained memory limit prevents this edge; search coverage is incomplete');
   try{
    workerJobs++;const result=await executeJob({operation:'sequence-advance',moduleBase64,snapshot,response},{snapshotKey,trustedPrepared:prepared,signal,prepareDeadlineMs:PREPARATION_DEADLINE_MS,deadlineMs:DEADLINE_MS});
    const node=publicNode(result,{nodeId:`n${nodes.length}`,parentId:parent.nodeId,response,additionalResponses:[...parent.additionalResponses,response]},digest);
    if(result.snapshot){if(retainedBytes+result.summary.memoryBytes>RETAINED_MEMORY_BYTES)throw Error('The resulting cut exceeds the 128MiB retained memory limit');snapshots.set(node.nodeId,result.snapshot);retainedBytes+=result.summary.memoryBytes;peakRetainedBytes=Math.max(peakRetainedBytes,retainedBytes);remaining.set(node.nodeId,options.settings.alphabet.length);}
    // Completed result memory has no further role here; retain only actual report and hashes.
    nodes.push(node);edges.set(edgeKey,node);return node;
   }finally{const left=remaining.get(parent.nodeId)-1;remaining.set(parent.nodeId,left);if(left===0)release(parent.nodeId);}
  }});
  await writeJsonNew(path.join(options.out,'nodes.json'),{schema:'forkwake.sequence-nodes',version:1,module:{name,sha256:digest},nodes},signal);
  await writeJsonNew(path.join(options.out,'search.json'),{schema:'forkwake.sequence-search',version:1,module:{name,sha256:digest},execution,search,limits:{nodeRecords:MAX_NODES,retainedGuestMemoryBytes:RETAINED_MEMORY_BYTES},actual:{workerJobs,nodeRecords:nodes.length,peakRetainedGuestMemoryBytes:peakRetainedBytes,retainedPausedCuts:snapshots.size},...(search.witnessNodeId?{witness:nodes.find(n=>n.nodeId===search.witnessNodeId)}:{})},signal);
  complete=true;return {directory:options.out,workspace:'workspace.forkwake',search:'search.json',nodes:'nodes.json',matched:search.matched,minimalWithinBounds:search.minimalWithinBounds,...(search.witnessResponses?{witnessResponses:search.witnessResponses,witnessCost:search.witnessCost}:{}),executed:search.executed};
 }finally{if(!complete){try{await fs.rmdir(options.out);}catch{/* Keep partial owned exports for inspection and portable recovery. */}}}
}
async function execute(options,signal){
 let original,bytes,name;
 if(options.command==='resume'){const text=await readBounded(options.workspace,WORKSPACE_BYTES,'Workspace');try{original=JSON.parse(text.toString('utf8'));}catch{throw Error('Workspace is not valid JSON');}bytes=validateWorkspace(original);name=original.module.name;}
 else{const source=options.command==='demo'?fileURLToPath(new URL('examples/sqlite/workflow.raw.wasm',ROOT)):options.module;bytes=await readBounded(source,MODULE_BYTES,'Module');name=options.command==='demo'?'SQLite3.54: live transaction and SQL callback':path.basename(source);if(name.length>256)throw Error('Module name is too long');}
 const digest=sha(bytes),moduleBase64=bytes.toString('base64'),snapshotKey=randomBytes(32).toString('hex');
 try{await fs.mkdir(options.out,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw Error('Output directory already exists; choose a new directory');throw error;}
 let complete=false;
 try{
  const request=original?{operation:'import',moduleBase64,snapshot:original.snapshot}:{operation:'capture',moduleBase64,entry:'run',args:[options.input]};
  const captured=await workerJob(request,{snapshotKey,signal}),prepared=cache(captured),branches=[],outcomes=[];
  for(let index=0;index<options.responses.length;index++){
   const response=options.responses[index],label=options.command==='demo'?['Approved','Declined','Timeout'][index]:`Response ${response}`;
   const result=await workerJob({operation:'fork',moduleBase64,snapshot:captured.snapshot,response},{snapshotKey,trustedPrepared:prepared,signal});
   const report=reportFromMemory(digest,result.finalMemoryBase64),record={label,response,summary:result.summary,...(report?{report}:{})};
   if(options.memory){const memory=decode(result.finalMemoryBase64,MEMORY_BYTES,'final memory');const filename=`final-memory-${String(index+1).padStart(2,'0')}.bin`;await writeNew(path.join(options.out,filename),memory,signal);record.memoryFile=filename;}
   branches.push({label,response});outcomes.push(record);
  }
  const workspace={schema:'forkwake.workspace',version:1,module:{name,sha256:digest,dataBase64:moduleBase64},snapshot:captured.snapshot,settings:{entry:captured.snapshot.entry,args:captured.snapshot.args},branches};
  const encoded=JSON.stringify(workspace,null,2)+'\n';if(Buffer.byteLength(encoded)>WORKSPACE_BYTES)throw Error('Workspace exceeds the 64MiB export limit');
  const summary={schema:'forkwake.outcomes',version:1,operation:options.command,module:{name,sha256:digest},capture:captured.summary,
   execution:{prefixIndependentlyReexecutedForImport:original!==undefined,branchPrefixReexecuted:false,preparationDeadlineMs:PREPARATION_DEADLINE_MS,workerDeadlineMs:DEADLINE_MS,transformPolicy:POLICY},branches:outcomes,
   scope:'One owned pending cut. Portable resume independently recaptures once; sibling branches restore that validated continuation.'};
  const reportBytes=JSON.stringify(summary,null,2)+'\n';if(Buffer.byteLength(reportBytes)>16*1024*1024)throw Error('Outcome summaries exceed their export limit');
  await writeNew(path.join(options.out,'workspace.forkwake'),encoded,signal);await writeNew(path.join(options.out,'outcomes.json'),reportBytes,signal);complete=true;
  return {directory:options.out,workspace:'workspace.forkwake',outcomes:'outcomes.json',branches:branches.length,importReexecutedPrefix:original!==undefined};
 }finally{if(!complete){try{await fs.rmdir(options.out);}catch{/* Retain any partial owned output files for inspection. */}}}
}
export async function main(argv=process.argv.slice(2)){
 const options=parseArgs(argv);if(options.command==='help'){console.log(help+sequenceHelp);return;}
 const controller=new AbortController();let interrupted;
 const stop=signal=>{interrupted=signal;controller.abort();};const onInt=()=>stop('SIGINT'),onTerm=()=>stop('SIGTERM');
 process.once('SIGINT',onInt);process.once('SIGTERM',onTerm);
 try{
  if(options.command==='serve'){
   const {createServer}=await import('./server.mjs');const app=await createServer({port:options.port});console.log('Open '+app.origin);
   try{if(!controller.signal.aborted)await new Promise(resolve=>controller.signal.addEventListener('abort',resolve,{once:true}));}finally{await app.close();}
  }else{const result=await (['explore','continue'].includes(options.command)?executeSequence(options,controller.signal):execute(options,controller.signal));console.log(JSON.stringify(result));}
 }catch(error){if(interrupted)process.exitCode=interrupted==='SIGINT'?130:143;throw error;}
 finally{process.removeListener('SIGINT',onInt);process.removeListener('SIGTERM',onTerm);if(interrupted&&!process.exitCode)process.exitCode=interrupted==='SIGINT'?130:143;}
}
// npm bin links leave argv[1] as the symlink while Node resolves this module.
// Compare real files, and keep imports inert when argv names another entry.
let directEntry=false;
if(process.argv[1]){
 try{const [entry,moduleFile]=await Promise.all([fs.realpath(process.argv[1]),fs.realpath(fileURLToPath(import.meta.url))]);directEntry=entry===moduleFile;}catch{/* A missing argv path is not this executable. */}
}
if(directEntry)main().catch(error=>{console.error('Forkwake: '+error.message);process.exitCode ||= 1;});
