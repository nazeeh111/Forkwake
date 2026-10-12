const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
export function decodeReport(memory,manifest){
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
 return report;
}
