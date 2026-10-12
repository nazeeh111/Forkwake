import {i32,SEQUENCE_LIMIT} from './runtime.mjs';

export function searchSettings({alphabet,baseline,maxDepth,maxJobs,goal}){
  if(!Array.isArray(alphabet)||!alphabet.length||alphabet.length>5)throw Error('Choose one to five distinct i32 responses.');alphabet.forEach(i32);if(new Set(alphabet).size!==alphabet.length)throw Error('Response alphabet has duplicate values.');
  if(!Number.isInteger(maxDepth)||maxDepth<1||maxDepth>SEQUENCE_LIMIT)throw Error('Additional decision limit must be between1and32.');
  if(!Array.isArray(baseline)||baseline.length!==maxDepth||baseline.some(n=>!alphabet.includes(n)))throw Error('Baseline must provide one allowed response per additional decision.');baseline.forEach(i32);
  if(!Number.isInteger(maxJobs)||maxJobs<1||maxJobs>128)throw Error('Search supports1to128 edge attempts.');i32(goal);
  return {alphabet:[...alphabet],baseline:[...baseline],maxDepth,maxJobs,goal};
}

/** Uniform-cost concrete search: cost is changed decisions, never a fabricated causal score. */
export async function searchFutures({root,advance,settings,signal,onProgress}){
  const s=searchSettings(settings);if(root.status!=='captured')throw Error('Search starts at a paused continuation.');
  const sourceResponses=root.summary?.decisions?.map(d=>d.response)??root.path??[];
  const report={...s,sourceNodeId:root.nodeId,sourceResponses:[...sourceResponses],executed:0,reused:0,terminals:0,matched:0,minimalWithinBounds:false,exhausted:false,depthLimited:0,failed:0,cancelled:false,budgetLimited:false,frontier:0,errors:[],scope:'Only terminal executions from the declared starting cut, within the response alphabet and additional decision limit; change count is relative to the supplied additional-decision baseline. No claim about arbitrary responses or external effects.'};
  let serial=0;const queue=[],unresolved=[];
  const enqueue=(node,path,cost)=>{for(const response of s.alphabet)queue.push({node,response,path:[...path,response],cost:cost+(response===s.baseline[path.length]?0:1),serial:serial++});};
  enqueue(root,[],0);
  while(queue.length){
    if(signal?.aborted){report.cancelled=true;break;}
    if(report.executed>=s.maxJobs){report.budgetLimited=true;break;}
    queue.sort((a,b)=>a.cost-b.cost||a.path.length-b.path.length||a.serial-b.serial);
    const edge=queue.shift();report.executed++;
    let node;
    try{node=await advance(edge.node,edge.response);if(signal?.aborted){report.cancelled=true;unresolved.push(edge.cost);break;}if(node.reused)report.reused++;}
    catch(error){if(signal?.aborted){report.cancelled=true;unresolved.push(edge.cost);break;}report.failed++;unresolved.push(edge.cost);report.errors.push({responses:edge.path,message:String(error.message).slice(0,512)});onProgress?.(report);continue;}
    if(node.status==='completed'){
      report.terminals++;
      if(node.summary.returnI32===s.goal){
        report.matched++;report.witnessNodeId=node.nodeId;report.witnessResponses=edge.path;report.witnessCost=edge.cost;
        // Unexpanded edges are lower bounds on any eventual terminal's change count.
        report.minimalWithinBounds=!unresolved.some(c=>c<edge.cost)&&!queue.some(e=>e.cost<edge.cost);
        break;
      }
    }else if(node.status==='captured'){
      if(edge.path.length>=s.maxDepth){report.depthLimited++;unresolved.push(edge.cost);}
      else enqueue(node,edge.path,edge.cost);
    }else{report.failed++;unresolved.push(edge.cost);report.errors.push({responses:edge.path,message:'Unexpected execution status'});}
    onProgress?.(report);
  }
  report.frontier=queue.length;report.exhausted=!queue.length&&!report.failed&&!report.depthLimited&&!report.cancelled&&!report.budgetLimited;
  return report;
}
