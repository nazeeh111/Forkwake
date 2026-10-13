import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {injectScript,inspectScriptModule} from './script-loader.mjs';
import {decodeReport} from './script-report.mjs';
import {decodeBase64} from './runtime.mjs';

export const SCRIPT_TEMPLATE_SHA='85d3e5e3abc886b04db27c92afef9435834f791cb337d0301d808fb14982c9a4';
export const ORIGIN_TEMPLATE_SHA='a6bf4fb95d8ecfb656e6d5b6631e4d8fa015341cb5e728e45c456948a070930d';
export const ORIGIN_WARNING='Origin shows the active call stack only. It allocates, may be unavailable or clipped, and does not prove data flow or complete async ancestry.';
export const SCRIPT_LIMITS=Object.freeze({sourceBytes:1048575,requestedHeapBytes:4194304,memoryBytes:33554432,labelBytes:96,payloadBytes:4096,outputBytes:16383,interruptCallbacks:10000});
const ROOT=new URL('../examples/javascript/',import.meta.url);
const variants=[
 {originTracing:false,sha256:SCRIPT_TEMPLATE_SHA,file:'quickjs-template.raw.wasm',manifest:JSON.parse(readFileSync(new URL('template-manifest.json',ROOT),'utf8'))},
 {originTracing:true,sha256:ORIGIN_TEMPLATE_SHA,file:'origin-template.raw.wasm',manifest:JSON.parse(readFileSync(new URL('origin-template-manifest.json',ROOT),'utf8'))}
];
for(const variant of variants)if(variant.manifest.templateSha256!==variant.sha256||!!variant.manifest.memoryOrigin!==variant.originTracing)throw Error('JavaScript template manifest identity differs.');
const sha=b=>createHash('sha256').update(b).digest('hex');
function nameOf(name){if(typeof name!=='string'||!name.length||name.length>256||/[\u0000-\u001f\u007f]/.test(name))throw Error('Use a script name of one to256 printable characters.');return name;}
function recognized(bytes){
 for(const variant of variants){if(bytes.length!==variant.manifest.moduleBytes)continue;try{const info=inspectScriptModule(bytes,variant.manifest);return {variant,info:{source:info.source,sourceSha256:info.sourceSha256,sourceBytes:info.sourceBytes,templateSha256:info.templateSha256,limits:{...SCRIPT_LIMITS},originTracing:variant.originTracing,originWarning:variant.originTracing?ORIGIN_WARNING:null}};}catch{}}
 return null;
}
export function scriptModuleInfo(bytes){return recognized(bytes)?.info??null;}
export async function loadScriptModule(source,{name='workflow.js',origin=false}={}){
 nameOf(name);if(typeof origin!=='boolean')throw Error('Origin must be a boolean');const variant=variants.find(x=>x.originTracing===origin);
 if(!variant.template){const bytes=await fs.readFile(new URL(variant.file,ROOT));if(sha(bytes)!==variant.sha256)throw Error('Bundled JavaScript interpreter identity differs.');variant.template=bytes;}
 const injected=injectScript(variant.template,source,variant.manifest),info={source,sourceSha256:injected.sourceSha256,sourceBytes:injected.sourceBytes,templateSha256:variant.sha256,limits:{...SCRIPT_LIMITS},originTracing:origin,originWarning:origin?ORIGIN_WARNING:null};
 return {bytes:injected.bytes,sha256:injected.moduleSha256,sourceSha256:injected.sourceSha256,sourceBytes:injected.sourceBytes,name,originTracing:origin,originWarning:info.originWarning,script:info};
}
export function scriptReportFromBytes(moduleBytes,memory){const known=recognized(moduleBytes);if(!known)return null;return decodeReport(memory,known.variant.manifest,known.info);}
export function scriptReportFromMemory(moduleBytes,memoryBase64){const known=recognized(moduleBytes);if(!known)return null;return decodeReport(decodeBase64(memoryBase64,32*1024*1024,'JavaScript guest memory'),known.variant.manifest,known.info);}
export function scriptObserver(moduleBytes,{initialCapture=false}={}){
 const known=recognized(moduleBytes);if(!known)return undefined;let count=0;
 return ({memory,resultI32,suspended})=>{
  const report=decodeReport(memory,known.variant.manifest,known.info);++count;
  if(report.status==='error')throw Error('JavaScript: '+(report.diagnostic||'Guest execution failed.'));
  if(suspended&&report.status!=='pending'||!suspended&&report.status!=='completed')throw Error('JavaScript report differs from actual execution state.');
  if(!suspended&&report.resultI32!==resultI32)throw Error('JavaScript result differs from actual guest return.');
  if(initialCapture&&count===1&&!suspended)throw Error('Script completed without a decision. Call decision(...) to capture a future.');
 };
}
