#!/usr/bin/env node
import fs from 'node:fs/promises';
import {constants as FS} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {reportFromMemory} from './lib/fixture.mjs';

const ROOT=new URL('./',import.meta.url),MODULE_BYTES=8*1024*1024,WORKSPACE_BYTES=64*1024*1024,MEMORY_BYTES=32*1024*1024;
const DEADLINE_MS=30000,MAX_BRANCHES=12,POLICY='closed-wasm32-pure-accessors-v2';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const help=`Forkwake: fork one paused, owned WebAssembly continuation\n\nUsage:\n  forkwake serve [--port 6350]\n  forkwake demo --out <new directory> [--memory]\n  forkwake run --module <wasm> --input <signed i32> --responses <comma-separated signed i32s> --out <new directory> [--memory]\n  forkwake resume --workspace <workspace.forkwake> --responses <comma-separated signed i32s> --out <new directory> [--memory]\n\nOutputs: workspace.forkwake and outcomes.json. --memory also writes actual final-memory binaries. Existing output directories are refused.\n\nThe guest ABI is run(i32)->i32, header_address()->i32, asyncify_capacity()->i32, an owned bounded wasm32 memory, and exact owned env effect imports. One pending cut is supported. Native processes, files, network connections and threads are not cloned.\n\nPortable resume independently re-executes and validates the original prefix once. Its subsequent sibling branches resume the validated cut without replaying that prefix. Each worker has a 30-second deadline.\n`;
function exact(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw Error(`Invalid ${label} fields`);}
function i32Text(text,label){if(typeof text!=='string'||!/^(?:0|-[1-9][0-9]{0,9}|[1-9][0-9]{0,9})$/.test(text))throw Error(`${label} must be a decimal signed i32`);const value=Number(text);if(!Number.isInteger(value)||value< -2147483648||value>2147483647)throw Error(`${label} is outside the signed i32 range`);return value;}
function responses(text){const parts=text.split(',');if(!parts.length||parts.length>MAX_BRANCHES)throw Error(`Choose between one and ${MAX_BRANCHES} responses`);return parts.map(part=>i32Text(part,'Response'));}
export function parseArgs(argv){
 if(!Array.isArray(argv)||argv.some(arg=>typeof arg!=='string'))throw Error('Arguments must be strings');
 if(!argv.length||argv.length===1&&['help','--help','-h'].includes(argv[0]))return {command:'help'};
 const [command,...rest]=argv;if(!['serve','demo','run','resume'].includes(command))throw Error(`Unknown command: ${command}`);
 if(rest.length===1&&['--help','-h'].includes(rest[0]))return {command:'help'};
 const allowed={serve:['--port'],demo:['--out','--memory'],run:['--module','--input','--responses','--out','--memory'],resume:['--workspace','--responses','--out','--memory']}[command];
 const flags={};for(let index=0;index<rest.length;index++){
  const name=rest[index];if(!allowed.includes(name))throw Error(`Unknown ${command} option: ${name}`);if(Object.hasOwn(flags,name))throw Error(`Duplicate option: ${name}`);
  if(name==='--memory'){flags[name]=true;continue;}
  const value=rest[++index];if(value===undefined||value===''||value.startsWith('--'))throw Error(`Missing value for ${name}`);flags[name]=value;
 }
 if(command==='serve'){const raw=flags['--port']??'6350';if(!/^(?:0|[1-9][0-9]{0,4})$/.test(raw)||Number(raw)>65535)throw Error('Port must be an integer from 0 to 65535');return {command,port:Number(raw)};}
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
function validateWorkspace(workspace){
 exact(workspace,['schema','version','module','snapshot','settings','branches'],'workspace');if(workspace.schema!=='forkwake.workspace'||workspace.version!==1)throw Error('Unsupported workspace version');
 exact(workspace.module,['name','sha256','dataBase64'],'workspace module');const m=workspace.module;if(typeof m.name!=='string'||m.name.length>256||typeof m.sha256!=='string'||!/^[a-f0-9]{64}$/.test(m.sha256))throw Error('Invalid saved module identity');
 const bytes=decode(m.dataBase64,MODULE_BYTES,'module bytes');if(sha(bytes)!==m.sha256)throw Error('Saved module digest does not match its bytes');
 exact(workspace.settings,['entry','args'],'workspace settings');const s=workspace.settings;
 if(s.entry!=='run'||!Array.isArray(s.args)||s.args.length!==1||!Number.isInteger(s.args[0])||s.args[0]<-2147483648||s.args[0]>2147483647)throw Error('Saved settings require run(i32)');
 if(!workspace.snapshot||workspace.snapshot.entry!==s.entry||JSON.stringify(workspace.snapshot.args)!==JSON.stringify(s.args))throw Error('Saved settings differ from the captured entry arguments');
 if(!Array.isArray(workspace.branches)||workspace.branches.length>MAX_BRANCHES)throw Error('Too many saved branches');
 for(const branch of workspace.branches){exact(branch,['label','response'],'saved branch');if(typeof branch.label!=='string'||branch.label.length>64||!Number.isInteger(branch.response)||branch.response< -2147483648||branch.response>2147483647)throw Error('Invalid saved branch');}
 return bytes;
}
/** Trusted owner configuration stays outside guest request/workspace JSON. */
export function workerJob(request,{snapshotKey,trustedPrepared,signal,deadlineMs=DEADLINE_MS}={}){
 if(signal?.aborted)return Promise.reject(Error('Interrupted before the worker started'));
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('lib/worker.mjs',ROOT),{workerData:{request,snapshotKey,trustedPrepared},resourceLimits:{maxOldGenerationSizeMb:384,maxYoungGenerationSizeMb:64,stackSizeMb:8}});
  let done=false;const finish=async(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);await worker.terminate();if(error)reject(error);else resolve(result);};
  const abort=()=>{void finish(Error('Interrupted; active worker terminated'));};
  const timer=setTimeout(()=>{void finish(Error(`Worker exceeded the ${deadlineMs===DEADLINE_MS?'30-second':deadlineMs+'-millisecond'} deadline; no outcome accepted`));},deadlineMs);
  signal?.addEventListener('abort',abort,{once:true});
  worker.once('message',packet=>{if(!packet||packet.ok!==true)void finish(Error(packet?.error||'Guest job failed'));else void finish(null,packet.result);});
  worker.once('error',error=>{void finish(error);});worker.once('exit',()=>{if(!done)void finish(Error('Worker exited without an accepted result'));});
 });
}
function cache(result){const prepared=result.internalPrepared;if(!prepared||prepared.metadata?.version!==2||prepared.metadata.validationPolicy!==POLICY)throw Error('Worker did not return the current validated transform cache');return prepared;}
async function writeNew(filename,bytes,signal){if(signal?.aborted)throw Error('Interrupted before writing output');await fs.writeFile(filename,bytes,{flag:'wx',mode:0o600,signal});}
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
   execution:{prefixIndependentlyReexecutedForImport:original!==undefined,branchPrefixReexecuted:false,workerDeadlineMs:DEADLINE_MS,transformPolicy:POLICY},branches:outcomes,
   scope:'One owned pending cut. Portable resume independently recaptures once; sibling branches restore that validated continuation.'};
  const reportBytes=JSON.stringify(summary,null,2)+'\n';if(Buffer.byteLength(reportBytes)>16*1024*1024)throw Error('Outcome summaries exceed their export limit');
  await writeNew(path.join(options.out,'workspace.forkwake'),encoded,signal);await writeNew(path.join(options.out,'outcomes.json'),reportBytes,signal);complete=true;
  return {directory:options.out,workspace:'workspace.forkwake',outcomes:'outcomes.json',branches:branches.length,importReexecutedPrefix:original!==undefined};
 }finally{if(!complete){try{await fs.rmdir(options.out);}catch{/* Retain any partial owned output files for inspection. */}}}
}
export async function main(argv=process.argv.slice(2)){
 const options=parseArgs(argv);if(options.command==='help'){console.log(help);return;}
 const controller=new AbortController();let interrupted;
 const stop=signal=>{interrupted=signal;controller.abort();};const onInt=()=>stop('SIGINT'),onTerm=()=>stop('SIGTERM');
 process.once('SIGINT',onInt);process.once('SIGTERM',onTerm);
 try{
  if(options.command==='serve'){
   const {createServer}=await import('./server.mjs');const app=await createServer({port:options.port});console.log('Open '+app.origin);
   try{if(!controller.signal.aborted)await new Promise(resolve=>controller.signal.addEventListener('abort',resolve,{once:true}));}finally{await app.close();}
  }else{const result=await execute(options,controller.signal);console.log(JSON.stringify(result));}
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
