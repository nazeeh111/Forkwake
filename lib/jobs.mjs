import {Worker} from 'node:worker_threads';

/** A cancellable, bounded worker. The trusted phase precedes every guest instance. */
export function executeJob(request,{snapshotKey,trustedPrepared,prepareDeadlineMs=90000,deadlineMs=30000,signal,onStage}={}){
  if(signal?.aborted)return Promise.reject(signal.reason??new Error('Cancelled'));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./worker.mjs',import.meta.url),{workerData:{request,snapshotKey,trustedPrepared},resourceLimits:{maxOldGenerationSizeMb:384,maxYoungGenerationSizeMb:64,stackSizeMb:8}});
    let settled=false,execution=false,timer;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(result);};
    const arm=(ms,label)=>{clearTimeout(timer);timer=setTimeout(()=>finish(new Error(`${label} exceeded its ${ms/1000}-second deadline. No new outcome was accepted.`)),ms);};
    const abort=()=>finish(signal.reason??new Error('Cancelled'));
    signal?.addEventListener('abort',abort,{once:true});arm(prepareDeadlineMs,'Preparation');
    worker.on('message',packet=>{
      if(settled)return;
      if(packet?.phase){if(packet.phase!=='execution'||Object.keys(packet).length!==1||execution)return finish(new Error('Invalid or repeated worker execution transition.'));execution=true;arm(deadlineMs,'Guest execution');onStage?.('execution');return;}
      if(packet?.ok){if(!execution)return finish(new Error('Worker returned an outcome before its execution transition.'));return finish(null,packet.result);}
      finish(new Error(packet?.error??'Guest operation failed.'));
    });
    worker.once('error',error=>finish(error));worker.once('exit',()=>finish(new Error('Worker stopped without accepting an outcome.')));
  });
}
