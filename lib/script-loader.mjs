import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
export const SOURCE_CAPACITY=1024*1024;
export function describeTemplate(bytes){
  const b=Buffer.from(bytes);if(b.length<8||!b.subarray(0,8).equals(Buffer.from([0,97,115,109,1,0,0,0])))throw Error('Invalid WebAssembly header');
  let p=8,found,report;
  function leb(end,signed=false){let value=0,shift=0,byte;for(let n=0;n<5;n++){if(p>=end)throw Error('Truncated LEB');byte=b[p++];value+=(byte&127)*2**shift;shift+=7;if(!(byte&128)){if(signed&&(byte&64))value-=2**shift;return value;}}throw Error('Oversized LEB');}
  while(p<b.length){const id=b[p++],size=leb(b.length),end=p+size;if(end>b.length)throw Error('Section out of bounds');if(id===11){const count=leb(end);for(let i=0;i<count;i++){
    const flag=leb(end);if(flag!==0)throw Error('Expected simple active owned data segment');if(b[p++]!==0x41)throw Error('Expected constant i32 data address');const address=leb(end,true);if(address<0||b[p++]!==0x0b)throw Error('Invalid data offset');const n=leb(end),start=p,stop=start+n;if(stop>end)throw Error('Data payload out of bounds');
    const begin=Buffer.from('FORKWAKE_QJS_SOURCE_BEGIN_V1'),tail=Buffer.from('FORKWAKE_QJS_SOURCE_END_V1');let at=b.subarray(start,stop).indexOf(begin);
    if(at>=0){if(found||b.subarray(start,stop).indexOf(begin,at+1)>=0)throw Error('Ambiguous source marker');const slotOffset=start+at+32,tailOffset=slotOffset+SOURCE_CAPACITY;if(tailOffset+32>stop||!b.subarray(tailOffset,tailOffset+tail.length).equals(tail))throw Error('Source slot not inside one complete active segment');found={binaryOffset:slotOffset,memoryAddress:address+at+32,capacity:SOURCE_CAPACITY,dataSegment:i};}
    const reportBegin=Buffer.from('FORKWAKE_QJS_REPORT_BEGIN_V1'),reportEnd=Buffer.from('FORKWAKE_QJS_REPORT_END_V1');const reportAt=b.subarray(start,stop).indexOf(reportBegin);
    if(reportAt>=0){if(report)throw Error('Ambiguous report marker');const reportBinary=start+reportAt+32,tail=reportBinary+24738;if(tail+32>stop||!b.subarray(tail,tail+reportEnd.length).equals(reportEnd))throw Error('Report not inside one complete active segment');report={version:1,memoryAddress:address+reportAt+32,byteLength:24738,words:{version:0,status:4,resultI32:8,entryCount:12,outputBytes:16,diagnosticBytes:20,pendingKind:24,ordinal:28,labelBytes:32,payloadBytes:36,allocatedBytes:40,peakAllocatedBytes:44,deniedAllocations:48,heapLimitBytes:52,instructionInterrupts:56,unhandledPromises:60},buffers:{label:{offset:64,capacity:97},payload:{offset:161,capacity:4097},output:{offset:4258,capacity:16384},diagnostic:{offset:20642,capacity:4096}}};}
    p=stop;
  }if(p!==end)throw Error('Trailing data section bytes');}p=end;}
  if(!report)throw Error('Guest report absent');if(!found)throw Error('Source slot absent');const normalized=Buffer.from(b);normalized.fill(0,found.binaryOffset,found.binaryOffset+found.capacity);
  return {schema:1,templateSha256:hash(b),normalizedSha256:hash(normalized),moduleBytes:b.length,slot:found,memoryReport:report};
}
function binding(bytes,manifest){
  if(manifest.schema!==1||manifest.slot.capacity!==SOURCE_CAPACITY||!Number.isInteger(manifest.moduleBytes)||manifest.moduleBytes>8*1024*1024||!Number.isInteger(manifest.slot.binaryOffset)||manifest.slot.binaryOffset<8||manifest.slot.binaryOffset+SOURCE_CAPACITY>manifest.moduleBytes)throw Error('Invalid trusted template manifest');
  const b=Buffer.from(bytes);if(b.length!==manifest.moduleBytes)throw Error('Module length differs from trusted interpreter');const normalized=Buffer.from(b);normalized.fill(0,manifest.slot.binaryOffset,manifest.slot.binaryOffset+SOURCE_CAPACITY);if(hash(normalized)!==manifest.normalizedSha256)throw Error('Executable or other interpreter bytes differ from trusted template');return b;
}
export function injectScript(template,source,manifest){
  const original=binding(template,manifest);if(hash(original)!==manifest.templateSha256)throw Error('Injection requires the exact pristine interpreter template');if(typeof source!=='string'||!source.length||source.includes('\0'))throw Error('Script must be nonempty text without NUL');
  const text=Buffer.from(source,'utf8');if(decoder.decode(text)!==source)throw Error('Script has unpaired surrogate characters');if(text.length>=SOURCE_CAPACITY)throw Error('UTF-8 script exceeds bounded source slot');
  const out=Buffer.from(original);out.fill(0,manifest.slot.binaryOffset,manifest.slot.binaryOffset+SOURCE_CAPACITY);text.copy(out,manifest.slot.binaryOffset);
  return {bytes:out,sourceSha256:hash(text),moduleSha256:hash(out),templateSha256:manifest.templateSha256,normalizedSha256:manifest.normalizedSha256,sourceBytes:text.length,slot:{...manifest.slot}};
}
export function inspectScriptModule(bytes,manifest){
  const b=binding(bytes,manifest),region=b.subarray(manifest.slot.binaryOffset,manifest.slot.binaryOffset+SOURCE_CAPACITY),end=region.indexOf(0);if(end<=0)throw Error('Missing bounded nonempty NUL-terminated source');if(region.subarray(end).some(x=>x!==0))throw Error('Hidden nonzero bytes after script terminator');const text=region.subarray(0,end),source=decoder.decode(text);return {source,sourceSha256:hash(text),moduleSha256:hash(b),templateSha256:manifest.templateSha256,normalizedSha256:manifest.normalizedSha256,sourceBytes:text.length,slot:{...manifest.slot}};
}
