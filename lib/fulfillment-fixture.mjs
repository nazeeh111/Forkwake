import {readFileSync} from 'node:fs';
const layout=JSON.parse(readFileSync(new URL('../examples/fulfillment/fixture-layout.json',import.meta.url),'utf8'));
export const FULFILLMENT_SHA=layout.sha256;
export const FULFILLMENT_FIELDS=Object.freeze(['pendingEffect','sqlCallbackEntriesAtCut','autocommitInsideEffect','cursorBusyInsideEffect','decisionStatementBusyInsideEffect','sqlCallbackLocalBefore','sqliteMemoryBytesAtCut','forbiddenFilesAtCut','response','sqlCallbackLocalAfter','savedLocalsChecksum','reservationResponse','paymentResponse','retryResponse','dispatchResponse','violatedShipWithoutReceipt','receipts','shipments','attempts','stock','reserved','autocommitAfter','cursorSum','cursorCount','workflowLocal','entryCount','callbackEntries','canaryChecksum','canaryMutation','forbiddenFiles','sqliteMemoryBytes','correctedPolicy']);
export function fulfillmentEffectName(effect){return layout.effects[String(effect)]??`Effect ${effect}`;}
// Interpret only the exact owned compiled example. Arbitrary guest bytes stay opaque.
export function reportFulfillmentFromMemory(moduleHash,memoryBase64){
  if(moduleHash!==FULFILLMENT_SHA)return undefined;
  const memory=Buffer.from(memoryBase64,'base64');
  const {resultsOffset,jsonOffset,jsonCapacity}=layout;
  if(memory.length!==layout.memoryBytes||resultsOffset+FULFILLMENT_FIELDS.length*4>memory.length||jsonOffset+jsonCapacity>memory.length)throw Error('Fulfillment example report bounds changed.');
  const report=Object.fromEntries(FULFILLMENT_FIELDS.map((name,i)=>[name,memory.readUInt32LE(resultsOffset+i*4)]));
  for(const field of ['response','reservationResponse','paymentResponse','retryResponse','dispatchResponse'])report[field]|=0;
  const text=memory.subarray(jsonOffset,jsonOffset+jsonCapacity),end=text.indexOf(0);
  if(end<0)throw Error('Fulfillment example report string has no bounded terminator.');
  if(end)report.rows=JSON.parse(text.subarray(0,end).toString('utf8'));
  report.pendingLabel=fulfillmentEffectName(report.pendingEffect);
  report.policy=report.correctedPolicy?'corrected':'deliberately faulty';
  report.finished=report.autocommitAfter===1;
  return report;
}
