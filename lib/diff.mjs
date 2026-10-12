import {sha256,LIMITS} from './transform.mjs';

export function diffMemory(left,right,{rangeLimit=256}={}){
  if(!(left instanceof Uint8Array)||!(right instanceof Uint8Array)||left.length>LIMITS.memoryBytes||right.length>LIMITS.memoryBytes)throw Error('Diff needs byte arrays within 32 MiB');
  if(!Number.isInteger(rangeLimit)||rangeLimit<0||rangeLimit>256)throw Error('Range limit must be 0..256');
  let changedBytes=0,firstDifference=null,start=null,totalRanges=0;const ranges=[],pageHeatmap=[];
  const size=Math.max(left.length,right.length);
  for(let page=0;page<Math.ceil(size/65536);page++){
    const low=page*65536,high=Math.min(size,low+65536);let changes=0;
    for(let i=low;i<high;i++){
      const differs=i>=left.length||i>=right.length||left[i]!==right[i];
      if(differs){changedBytes++;changes++;if(firstDifference===null)firstDifference=i;if(start===null)start=i;}
      else if(start!==null){totalRanges++;if(ranges.length<rangeLimit)ranges.push({offset:start,length:i-start});start=null;}
    }
    const a=left.subarray(low,Math.min(high,left.length)),b=right.subarray(low,Math.min(high,right.length));
    pageHeatmap.push({page,changedBytes:changes,leftSha256:sha256(a),rightSha256:sha256(b)});
  }
  if(start!==null){totalRanges++;if(ranges.length<rangeLimit)ranges.push({offset:start,length:size-start});}
  return {leftBytes:left.length,rightBytes:right.length,changedBytes,firstDifference,ranges,totalRanges,rangesTruncated:totalRanges>ranges.length,pageHeatmap};
}

export function diffGlobals(left,right){
  return [...new Set([...Object.keys(left),...Object.keys(right)])].sort().filter(name=>left[name]!==right[name]).map(name=>({name,before:left[name]??null,after:right[name]??null}));
}
