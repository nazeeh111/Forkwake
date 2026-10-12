import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {injectScript,inspectScriptModule} from './script-loader.mjs';
import {decodeReport} from './script-report.mjs';
import {decodeBase64} from './runtime.mjs';

export const SCRIPT_TEMPLATE_SHA='85d3e5e3abc886b04db27c92afef9435834f791cb337d0301d808fb14982c9a4';
export const SCRIPT_LIMITS=Object.freeze({sourceBytes:1048575,requestedHeapBytes:4194304,memoryBytes:33554432,labelBytes:96,payloadBytes:4096,outputBytes:16383,interruptCallbacks:10000});
const ROOT=new URL('../examples/javascript/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('template-manifest.json',ROOT),'utf8'));
if(manifest.templateSha256!==SCRIPT_TEMPLATE_SHA)throw Error('JavaScript template manifest identity differs.');
let template;
const sha=b=>createHash('sha256').update(b).digest('hex');
function nameOf(name){if(typeof name!=='string'||!name.length||name.length>256||/[\u0000-\u001f\u007f]/.test(name))throw Error('Use a script name of one to256 printable characters.');return name;}
export function scriptModuleInfo(bytes){
  if(bytes.length!==manifest.moduleBytes)return null;
  try{const info=inspectScriptModule(bytes,manifest);return {source:info.source,sourceSha256:info.sourceSha256,sourceBytes:info.sourceBytes,templateSha256:info.templateSha256,limits:{...SCRIPT_LIMITS}};}catch{return null;}
}
export async function loadScriptModule(source,{name='workflow.js'}={}){
  nameOf(name);
  if(!template){const bytes=await fs.readFile(new URL('quickjs-template.raw.wasm',ROOT));if(sha(bytes)!==SCRIPT_TEMPLATE_SHA)throw Error('Bundled JavaScript interpreter identity differs.');template=bytes;}
  const injected=injectScript(template,source,manifest);
  return {bytes:injected.bytes,sha256:injected.moduleSha256,sourceSha256:injected.sourceSha256,sourceBytes:injected.sourceBytes,name,script:{source,sourceSha256:injected.sourceSha256,sourceBytes:injected.sourceBytes,templateSha256:SCRIPT_TEMPLATE_SHA,limits:{...SCRIPT_LIMITS}}};
}
export function scriptReportFromBytes(moduleBytes,memory){if(!scriptModuleInfo(moduleBytes))return null;return decodeReport(memory,manifest);}
export function scriptReportFromMemory(moduleBytes,memoryBase64){if(!scriptModuleInfo(moduleBytes))return null;return decodeReport(decodeBase64(memoryBase64,32*1024*1024,'JavaScript guest memory'),manifest);}
export function scriptObserver(moduleBytes,{initialCapture=false}={}){
  if(!scriptModuleInfo(moduleBytes))return undefined;
  let count=0;
  return ({memory,resultI32,suspended})=>{
    const report=decodeReport(memory,manifest);++count;
    if(report.status==='error')throw Error('JavaScript: '+(report.diagnostic||'Guest execution failed.'));
    if(suspended&&report.status!=='pending'||!suspended&&report.status!=='completed')throw Error('JavaScript report differs from actual execution state.');
    if(!suspended&&report.resultI32!==resultI32)throw Error('JavaScript result differs from actual guest return.');
    if(initialCapture&&count===1&&!suspended)throw Error('Script completed without a decision. Call decision(...) to capture a future.');
  };
}
