import {parentPort,workerData} from 'node:worker_threads';
import {handle} from './runtime.mjs';
import {scriptObserver} from './script-fixture.mjs';

if(!parentPort)throw Error('Forkwake worker requires a worker-thread parent');
try{
  const request=workerData.request;
  const onGuestResult=request?.operation?.startsWith('sequence-')?scriptObserver(Buffer.from(request.moduleBase64??'','base64'),{initialCapture:request.operation!=='sequence-advance'}):undefined;
  const result=await handle(request,{snapshotKey:workerData.snapshotKey,trustedPrepared:workerData.trustedPrepared,onGuestResult,onPrepared:()=>parentPort.postMessage({phase:'execution'})});
  parentPort.postMessage({ok:true,result});
}catch(error){parentPort.postMessage({ok:false,error:error instanceof Error?error.message:'Guest job failed'});}
