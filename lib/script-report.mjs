import {createHash} from 'node:crypto';
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
export function decodeReport(memory,manifest,binding){
 const bytes=Buffer.from(memory),layout=manifest.memoryReport;
 if(!layout||layout.version!==1||!Number.isInteger(layout.memoryAddress)||layout.memoryAddress<0||layout.memoryAddress+layout.byteLength>bytes.length)throw Error('Trusted JavaScript report bounds are invalid');
 const view=new DataView(bytes.buffer,bytes.byteOffset+layout.memoryAddress,layout.byteLength),word=name=>view.getUint32(layout.words[name],true);
 if(word('version')!==1||word('status')<1||word('status')>3||word('heapLimitBytes')!==4194304||word('allocatedBytes')>4194304||word('peakAllocatedBytes')>4194304)throw Error('JavaScript report header or allocator bounds are invalid');
 const text=(name,lengthName)=>{const region=layout.buffers[name],length=word(lengthName);if(!Number.isInteger(region.offset)||region.offset<64||length>=region.capacity||region.offset+region.capacity>layout.byteLength||view.getUint8(region.offset+length)!==0)throw Error('JavaScript text report bounds are invalid');return utf8.decode(bytes.subarray(layout.memoryAddress+region.offset,layout.memoryAddress+region.offset+length));};
 const status=['','pending','completed','error'][word('status')];const report={kind:'javascript',finished:status!=='pending',status,output:text('output','outputBytes'),diagnostic:text('diagnostic','diagnosticBytes'),entryCount:word('entryCount'),allocatedBytes:word('allocatedBytes'),peakAllocatedBytes:word('peakAllocatedBytes'),deniedAllocations:word('deniedAllocations'),heapLimitBytes:word('heapLimitBytes'),instructionInterrupts:word('instructionInterrupts'),unhandledPromises:word('unhandledPromises')};
 if(status==='completed')report.resultI32=view.getInt32(layout.words.resultI32,true);
 if(status==='pending'){
  const pendingKind=word('pendingKind');if(pendingKind>1)throw Error('JavaScript pending report type is invalid');report.pendingKind=pendingKind===1?'decision':'effect';report.pendingOrdinal=word('ordinal');
  if(pendingKind===1){report.pendingLabel=text('label','labelBytes');if(!report.pendingLabel||report.pendingLabel.includes('\0'))throw Error('JavaScript decision label is invalid');const payload=text('payload','payloadBytes');report.pendingPayload=JSON.parse(payload);report.pendingPayloadJson=payload;}
 }
 if(manifest.memoryOrigin)report.origin=decodeOrigin(bytes,manifest,report,binding);
 return report;
}

/** Parse only the escaped, bounded backtrace emitted by the recognized Origin engine. */
export function parseOriginFrames(rawText,{source}={}){
 if(typeof rawText!=='string'||Buffer.byteLength(rawText)>4095)throw Error('Origin trace exceeds its bound');
 const sourceLines=typeof source==='string'?source.split(/\r\n|[\r\n\u2028\u2029]/u).length:0,frames=[];
 for(const row of rawText.split('\n')){
  if(frames.length===64)break;let match=row.match(/^    at ([^()\r\n]+) \(([^()\r\n]+):(\d{1,7}):(\d{1,7})\)$/u);
  if(match){const line=Number(match[3]),column=Number(match[4]);if(line<1||column<1||line>1048576||column>1048576)continue;frames.push({functionName:match[1],filename:match[2],line,column,sourceBound:match[2]==='script.js'&&line<=sourceLines});continue;}
  match=row.match(/^    at ([^()\r\n]+) \(([^()\r\n]+)\)$/u);
  if(match){frames.push({functionName:match[1],filename:match[2],line:null,column:null,sourceBound:false});continue;}
  match=row.match(/^    at ([^()\r\n]+)$/u);if(match)frames.push({functionName:match[1],filename:null,line:null,column:null,sourceBound:false});
 }
 return frames;
}
function decodeOrigin(bytes,manifest,report,binding){
 const layout=manifest.memoryOrigin;
 if(!layout||layout.version!==1||layout.byteLength!==4120||layout.text?.offset!==24||layout.text?.capacity!==4096||!Number.isInteger(layout.memoryAddress)||layout.memoryAddress<0||layout.memoryAddress+layout.byteLength>bytes.length)throw Error('Trusted Origin report bounds are invalid');
 if(!binding||typeof binding.source!=='string'||!/^[a-f0-9]{64}$/.test(binding.sourceSha256??'')||binding.templateSha256!==manifest.templateSha256||createHash('sha256').update(Buffer.from(binding.source,'utf8')).digest('hex')!==binding.sourceSha256)throw Error('Origin requires a verified script binding');
 const view=new DataView(bytes.buffer,bytes.byteOffset+layout.memoryAddress,layout.byteLength),word=name=>view.getUint32(layout.words[name],true),state=word('state'),length=word('bytes'),truncated=word('truncated'),ordinal=word('ordinal');
 if(word('version')!==1||word('reserved')!==0||state>2||length>4095||truncated>1||ordinal>32||view.getUint8(24+length)!==0||state===0&&(length||truncated||ordinal)||state===2&&(length||truncated||!ordinal)||state===1&&(!length||!ordinal))throw Error('Origin report flags or bounds are invalid');
 const main=new DataView(bytes.buffer,bytes.byteOffset+manifest.memoryReport.memoryAddress,manifest.memoryReport.byteLength),lastOrdinal=main.getUint32(manifest.memoryReport.words.ordinal,true),pendingKind=main.getUint32(manifest.memoryReport.words.pendingKind,true);
 if(state&& (ordinal!==lastOrdinal||pendingKind!==1))throw Error('Origin ordinal differs from the actual named decision');
 const rawText=utf8.decode(bytes.subarray(layout.memoryAddress+24,layout.memoryAddress+24+length));
 return {sourceSha256:binding.sourceSha256,templateSha256:binding.templateSha256,pendingOrdinal:state?ordinal:null,lastDecision:!!state&&report.status!=='pending',context:state?(report.status==='pending'?'pending-decision':'last-decision'):'none',state:state===1?(truncated?'truncated':'captured'):'unavailable',...(state===1?{}:{reason:state===0?'No current named decision origin.':'Trace metadata was unavailable; guest execution continued.'}),rawText,frames:parseOriginFrames(rawText,{source:binding.source})};
}
