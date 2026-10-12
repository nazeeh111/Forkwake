# Forkwake engine

The engine clones a real WebAssembly continuation at one owned pending effect. A branch starts from the captured guest memory, every mutable integer global, saved Asyncify stack frames and bridge history. It resumes the pending import with a chosen i32 response. It does not rerun the entry prefix. Each branch has its own instance and memory.

Binaryen 132 Asyncify is the established mechanism that rewrites the guest stack into serializable linear-memory frames. Forkwake adds the closed-module contract, state capture, exact restoration, authenticated reusable cuts, independently checked import, branch traces and memory/global comparison. It does not clone a native process or an arbitrary application's external resources.

## API

```js
import {handle} from './lib/runtime.mjs';
const trusted = {snapshotKey: serverGenerated32ByteHex};
const cut = await handle({operation:'capture', moduleBase64, entry:'run', args:[4]}, trusted);
const branch = await handle({operation:'fork', moduleBase64, snapshot:cut.snapshot, response:1}, trusted);
const imported = await handle({operation:'import', moduleBase64, snapshot:exportedSnapshot}, trusted);
```

The key is trusted server configuration, not a request field. Do not send it to a browser, include it in exports or persist it. A local in-process session key is used when this option is omitted. A fork verifies its seal before instantiating the guest. Module hashes, memory hashes, strict field types, all-global coverage, exact page count and saved-stack bounds are also checked. i64 globals use canonical signed decimal strings, preserving every bit across JSON.

A portable import does not trust its old seal or reported checks. It executes the original prefix once in a fresh instance, captures a new cut and requires exact equality of memory, globals, history, pending arguments, entry arguments, stack header and both module hashes. Only an identical cut receives the current session's seal. The summary explicitly reports `importReexecutedPrefix:true`. Nondeterministic or altered cuts fail import. Subsequent branches resume the validated continuation without prefix replay.

Capture returns `{snapshot,summary}`. Fork returns `{finalMemoryBase64,globals,summary}`. Summaries report actual guest returns, opaque prefix/suffix events `{stage,value}`, pending arguments `[arg0,arg1,arg2,arg3]`, global values and page hashes. A fork also includes `memoryDiff` and `globalDiff`. No database fields or outcomes are synthesized by the engine. Consumers may interpret a trusted fixture's memory layout outside the generic runtime.

`diffMemory(leftBytes,rightBytes,{rangeLimit:256})` returns exact `changedBytes`, `firstDifference`, bounded `{offset,length}` ranges, total range count and per-page change counts plus SHA256 hashes. Bytes present on only one side count as changes. `diffGlobals` compares exact restored values.

`lib/worker.mjs` consumes trusted `workerData={request,snapshotKey}` and posts `{ok:true,result}` or `{ok:false,error}`. The owning server must enforce the wall-clock deadline and terminate/cancel the worker. Direct `handle` calls execute synchronously within their calling process and are intended for controlled fixtures or a worker. No runtime route reads files, opens network connections, exposes a clock or supplies WASI capabilities to the guest.

Capture and import also return `internalPrepared:{bytesBase64,metadata,seal}`. The server keeps this transform cache private and passes it as trusted `workerData.trustedPrepared` on subsequent jobs; it must strip this field from browser/workspace responses. The engine authenticates this cache with a separate HMAC domain and binds the source and transformed hashes before reuse. Only code, validated metadata and a compiled module are cached; every capture and fork still creates a fresh guest instance. Warm forks therefore avoid rewriting the entire module again. Direct in-process calls keep at most one validated transform in memory.

## Guest contract and bounds

Required exports: `run(i32)->i32`, `header_address()->i32`, `asyncify_capacity()->i32`, and the single owned memory exported as `memory`. The two accessors execute only in the transformed path, so their complete owned call graph must pass a bounded static purity check before guest instantiation. Constants, locals, global reads, memory-size reads, nontrapping scalar arithmetic, straight-line blocks and conditionals are supported. Memory loads, writes, global setters, growth, imports, indirect calls, loops, recursion, potentially trapping arithmetic and other instruction forms are rejected. This check examines at most 512 expression nodes, 32 call levels and 64 expression levels. The shipped C accessors return constant addresses and sizes. An optional `_initialize()->void` runs on each fresh instance before state restoration. A start function is rejected. Initialization may not call the bridge.

Validated transform metadata names policy `closed-wasm32-pure-accessors-v2`. Cached transforms carry that policy in their separately authenticated content and HMAC domain. Caches from an older validation policy cannot bypass the strengthened accessor checks.

Allowed imports, with exact signatures:

- `env.pre_cut(i32,i32)->void`
- `env.pending_effect(i32,i32,i32,i32)->i32`
- `env.post_cut(i32,i32)->void`

Only `pending_effect` is mandatory. Its first execution suspends; rewind must reach the identical four arguments. Prefix callbacks are sealed after capture and throw if replayed. A second pending effect is rejected, so this version supports one cut, with arbitrarily many independent branches within server resource budgets.

Raw and transformed modules are capped at 8 MiB. Owned unshared wasm32 memory needs an explicit maximum of at most 32 MiB. Asyncify storage must already exist in that memory, have aligned header space and fit within 1 MiB. Trace history is capped at 4,096 events. Imported/shared memories, memory64, multiple memories, mutable non-integer globals and unowned imports are rejected.

Fixed unexported owned function tables are supported up to 4,096 entries. Only fixed active initializers referring to guest functions are permitted. Every fresh instance reconstructs its own table references from the same module; references are not copied between instances. Table mutation and reference-valued table reads, exported/imported tables, passive elements, passive data-segment state, reference extensions and exception extensions are rejected before execution. Classification is conservative and may reject unsupported code even when that code is unreachable. Both original and instrumented bytes pass native module validation.

## Evidence

Run `node --test tests/runtime.test.mjs`. Tests compare actual resumed compiled C and SQLite branches with repeated uninterrupted original-module controls. They exercise nested saved locals, actual allocation, live SQLite transaction and prepared cursor state, execution inside a registered SQLite SQL callback, exact i64 globals, memory growth, static indirect calls, sibling/cut isolation and restart-from-entry rejection. Negative cases cover forged and incompatible cuts, foreign globals, unsafe integers, callbacks during initialization, a second cut and unsupported module shapes.

These are runtime observations on the shipped fixtures and explicit restoration checks. They do not prove arbitrary Asyncify transformation correctness or universal application equivalence. The guest ABI, single-cut scope and absence of external capabilities are part of the result.
