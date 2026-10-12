import binaryen from 'binaryen';
import {createHash} from 'node:crypto';

export const LIMITS = Object.freeze({moduleBytes: 8*1024*1024, memoryBytes: 32*1024*1024, stackBytes: 1024*1024, events: 4096, tableEntries: 4096});
export const VALIDATION_POLICY = 'closed-wasm32-pure-accessors-v2';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const imports = Object.freeze({'env.pre_cut': [[binaryen.i32,binaryen.i32],binaryen.none], 'env.pending_effect': [[binaryen.i32,binaryen.i32,binaryen.i32,binaryen.i32],binaryen.i32], 'env.post_cut': [[binaryen.i32,binaryen.i32],binaryen.none]});

function memoryCount(bytes) {
  let p=8, count=0;
  const leb=end=>{let n=0,s=0;for(let i=0;i<5;i++){if(p>=end)throw Error('Truncated section');const b=bytes[p++];n+=(b&127)*2**s;if(!(b&128))return n;s+=7;}throw Error('Oversized section integer');};
  while(p<bytes.length){const id=bytes[p++],size=leb(bytes.length),end=p+size;if(end>bytes.length)throw Error('Truncated section');if(id===5)count=leb(end);p=end;}
  return count;
}

function signature(info, params, result, label) {
  const actual=binaryen.expandType(info.params);
  if(actual.length!==params.length||actual.some((x,i)=>x!==params[i])||info.results!==result)throw Error(`Unsupported ABI signature: ${label}`);
}

// These accessors execute only in the transformed path. Even one write would
// perturb the original program, so validate their complete owned call graph.
function pureAccessor(module,root,label){
  let nodes=0;const active=new Set(),done=new Set();
  const fail=()=>{throw Error(`ABI accessor must be bounded and side-effect-free: ${label}`);};
  const functionBody=(info,depth)=>{
    if(depth>32||info.module||info.base||active.has(info.name))fail();if(done.has(info.name))return;
    active.add(info.name);expression(info.body,0,depth);active.delete(info.name);done.add(info.name);
  };
  const expression=(ref,depth,callDepth)=>{
    if(!ref)return;if(++nodes>512||depth>64)fail();const n=binaryen.getExpressionInfo(ref);
    const child=x=>expression(x,depth+1,callDepth);
    switch(n.id){
      case binaryen.ConstId:case binaryen.LocalGetId:case binaryen.GlobalGetId:case binaryen.MemorySizeId:case binaryen.NopId:return;
      case binaryen.LocalSetId:case binaryen.DropId:case binaryen.ReturnId:child(n.value);return;
      case binaryen.BlockId:n.children.forEach(child);return;
      case binaryen.IfId:child(n.condition);child(n.ifTrue);child(n.ifFalse);return;
      case binaryen.SelectId:child(n.condition);child(n.ifTrue);child(n.ifFalse);return;
      case binaryen.UnaryId:case binaryen.BinaryId:
        if(binaryen.getSideEffects(ref,module.getFeatures())&binaryen.SideEffects.ImplicitTrap)fail();
        if(n.id===binaryen.UnaryId)child(n.value);else{child(n.left);child(n.right);}return;
      case binaryen.CallId:
        n.operands.forEach(child);functionBody(binaryen.getFunctionInfo(module.getFunction(n.target)),callDepth+1);return;
      default:fail();
    }
  };
  functionBody(root,0);
}

/** Transform a closed wasm32 module. Nothing from the guest executes here. */
export function instrument(input) {
  if(!(input instanceof Uint8Array)||!input.length||input.length>LIMITS.moduleBytes)throw Error('Module must be nonempty bytes within 8 MiB');
  const bytes=Uint8Array.from(input);
  const native=new WebAssembly.Module(bytes);
  if(memoryCount(bytes)!==1)throw Error('Exactly one owned memory is required');
  const seen=new Set();
  for(const item of WebAssembly.Module.imports(native)){
    const key=`${item.module}.${item.name}`;
    if(item.kind!=='function'||!Object.hasOwn(imports,key)||seen.has(key))throw Error(`Unowned or duplicate import: ${key} (${item.kind})`);
    seen.add(key);
  }
  if(!seen.has('env.pending_effect'))throw Error('The owned pending_effect import is required');
  const exports=WebAssembly.Module.exports(native);
  if(exports.some(x=>x.kind==='table'||x.name.startsWith('__forkwake_')||(x.name.startsWith('asyncify_')&&x.name!=='asyncify_capacity')))throw Error('Exported tables and reserved engine exports are unsupported');
  if(exports.filter(x=>x.kind==='memory').length!==1||!exports.some(x=>x.name==='memory'&&x.kind==='memory'))throw Error('Memory must have the single export named memory');
  const module=binaryen.readBinary(bytes);
  try {
    module.setFeatures(module.getFeatures()|binaryen.Features.MutableGlobals|binaryen.Features.ReferenceTypes|binaryen.Features.BulkMemory);
    if(module.getStart())throw Error('Start functions are unsupported');
    const text=module.emitText();
    if(/\bexternref\b/.test(text))throw Error('Only owned funcref static tables are supported');
    if(/\(table\.(?:get|set|grow|fill|copy|init)\b|\(elem\.drop\b/.test(text))throw Error('Mutable or reference-valued table operations are unsupported');
    if(/\(memory\.init\b|\(data\.drop\b/.test(text))throw Error('Passive data segment state is unsupported');
    if(/\(data(?:\s+\$[^\s()]+)?\s+"/.test(text))throw Error('Passive data segments are unsupported');
    if(/\((?:ref\.|struct\.|array\.|call_ref|try\b|try_table\b|throw\b|cont\.|resume\b|suspend\b)/.test(text))throw Error('Reference, exception and continuation extensions are unsupported');
    const memory=module.getMemoryInfo();
    if(memory.shared||memory.is64||memory.module||memory.base||memory.initial<1||memory.initial>512||!Number.isInteger(memory.max)||memory.max>512||memory.max<memory.initial)throw Error('Memory must be owned wasm32, unshared, with explicit maximum at most 32 MiB');
    for(let i=0;i<module.getNumGlobals();i++){
      const info=binaryen.getGlobalInfo(module.getGlobalByIndex(i));
      if(info.module||info.base)throw Error('Imported globals are unsupported');
      if(info.mutable&&info.type!==binaryen.i32&&info.type!==binaryen.i64)throw Error('Mutable globals must be i32 or i64');
    }
    for(let i=0;i<module.getNumFunctions();i++){
      const info=binaryen.getFunctionInfo(module.getFunctionByIndex(i));
      if(info.module||info.base)signature(info,...imports[`${info.module}.${info.base}`],`${info.module}.${info.base}`);
    }
    const exportFunction=(name,params,result,optional=false)=>{
      let info;
      for(let i=0;i<module.getNumExports();i++){const e=binaryen.getExportInfo(module.getExportByIndex(i));if(e.name===name){if(e.kind!==binaryen.ExternalFunction)throw Error(`Function export required: ${name}`);info=binaryen.getFunctionInfo(module.getFunction(e.value));}}
      if(!info){if(optional)return;throw Error(`Missing ABI export: ${name}`);}signature(info,params,result,name);return info;
    };
    exportFunction('run',[binaryen.i32],binaryen.i32);
    pureAccessor(module,exportFunction('header_address',[],binaryen.i32),'header_address');
    pureAccessor(module,exportFunction('asyncify_capacity',[],binaryen.i32),'asyncify_capacity');
    exportFunction('_initialize',[],binaryen.none,true);
    // Validate all original table segments before removal, including unreachable passive ones.
    for(let i=0;i<module.getNumElementSegments();i++){
      let s;try{s=binaryen.getElementSegmentInfo(module.getElementSegmentByIndex(i));}catch{throw Error('Passive or reference-valued element segments are unsupported');}
      if(!s.table)throw Error('Passive element segments are unsupported');
    }
    module.runPasses(['remove-unused-module-elements']);
    const tables=[];
    for(let i=0;i<module.getNumTables();i++){
      const info=binaryen.getTableInfo(module.getTableByIndex(i));
      if(info.module||info.base||info.initial>LIMITS.tableEntries||info.max!==info.initial)throw Error('Only fixed owned static tables are supported');
      const segments=[];
      for(let j=0;j<module.getNumElementSegments();j++){
        const s=binaryen.getElementSegmentInfo(module.getElementSegmentByIndex(j));if(s.table!==info.name)continue;
        const offset=binaryen.getExpressionInfo(s.offset);
        if(offset.id!==binaryen.ConstId||offset.type!==binaryen.i32||!Number.isInteger(offset.value)||offset.value<0||offset.value+s.data.length>info.initial)throw Error('Static table offset must be fixed and bounded');
        for(const name of s.data){const f=binaryen.getFunctionInfo(module.getFunction(name));if(f.module||f.base)throw Error('Static table must reference owned functions');}
        segments.push({offset:offset.value,functions:s.data.length});
      }
      tables.push({initial:info.initial,max:info.max,segments});
    }
    binaryen.setPassArgument('asyncify-imports','env.pending_effect');
    module.runPasses(['asyncify']);
    const globals=[];
    for(let i=0;i<module.getNumGlobals();i++){
      const info=binaryen.getGlobalInfo(module.getGlobalByIndex(i));
      if(info.module||info.base)throw Error('Imported globals are unsupported');
      if(!info.mutable)continue;
      if(info.type!==binaryen.i32&&info.type!==binaryen.i64)throw Error('Mutable globals must be i32 or i64');
      const exportName=`__forkwake_global_${i}`;
      module.addGlobalExport(info.name,exportName);
      globals.push({exportName,type:info.type===binaryen.i64?'i64':'i32'});
    }
    if(globals.length>4096)throw Error('Too many mutable globals');
    if(!module.validate())throw Error('Instrumented module validation failed');
    const transformed=Uint8Array.from(module.emitBinary());
    if(transformed.length>LIMITS.moduleBytes)throw Error('Instrumented module exceeds 8 MiB');
    new WebAssembly.Module(transformed);
    return {bytes:transformed,metadata:{version:2,validationPolicy:VALIDATION_POLICY,binaryenVersion:132,originalSha256:sha256(bytes),instrumentedSha256:sha256(transformed),memory:{initial:memory.initial,max:memory.max},globals,tables,allowedImports:[...seen].sort()}};
  } finally {module.dispose();}
}
