import {readFileSync} from 'node:fs';
const layout=JSON.parse(readFileSync(new URL('../examples/sqlite/fixture-layout.json',import.meta.url),'utf8'));
export const SQLITE_SHA=layout.sha256;
const fields=['response','autocommitBefore','cursorBusyBefore','cursorSum','cursorCount','orders','receipts','tempRows','attempts','autocommitAfter','canaryChecksum','savedLocalsChecksum','canaryMutation','receiptTotal','forbiddenFiles','sqliteMemoryBytes','deniedAttempts','timeoutAttempts','sqlCallbackLocal','sqlCallbackEntries','paymentStatementBusyInsideEffect','autocommitInsideEffect'];
// Only interpret the exact owned fixture. Generic guest bytes remain opaque.
export function reportFromMemory(moduleHash,memoryBase64){
  if(moduleHash!==SQLITE_SHA)return undefined;
  const memory=Buffer.from(memoryBase64,'base64');
  const {resultsOffset,jsonOffset,jsonCapacity}=layout;
  if(resultsOffset+fields.length*4>memory.length||jsonOffset+jsonCapacity>memory.length)throw Error('Example report bounds changed.');
  const report=Object.fromEntries(fields.map((name,i)=>[name,memory.readUInt32LE(resultsOffset+i*4)]));
  const text=memory.subarray(jsonOffset,jsonOffset+jsonCapacity),end=text.indexOf(0);
  if(end<0)throw Error('Example report string has no bounded terminator.');
  if(end)report.rows=JSON.parse(text.subarray(0,end).toString('utf8'));
  return report;
}
