import {parentPort,workerData} from 'node:worker_threads';
import {handle} from './runtime.mjs';

if(!parentPort)throw Error('Forkwake worker requires a worker-thread parent');
try{
  const result=await handle(workerData.request,{snapshotKey:workerData.snapshotKey,trustedPrepared:workerData.trustedPrepared,onPrepared:()=>parentPort.postMessage({phase:'execution'})});
  parentPort.postMessage({ok:true,result});
}catch(error){parentPort.postMessage({ok:false,error:error instanceof Error?error.message:'Guest job failed'});}
