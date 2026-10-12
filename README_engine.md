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

`lib/worker.mjs` consumes trusted `workerData={request,snapshotKey}` and posts `{ok:true,result}` or `{ok:false,error}`. The worker first posts `{phase:"execution"}` after validated preparation and before any guest instance, initialization or entry execution. Its owning host must enforce a bounded preparation deadline, then a separate execution deadline, and terminate/cancel the worker. Forkwake uses 90 seconds for preparation and 30 seconds for guest execution. A phase packet is progress, never an accepted outcome. Direct `handle` calls execute synchronously within their calling process and are intended for controlled fixtures or a worker. No runtime route reads files, opens network connections, exposes a clock or supplies WASI capabilities to the guest.

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

## Sequential operations (0.2)

The original operations above keep schema1 and their single-cut behavior. The sequential family uses schema2, the same validated closed module and the same authenticated prepared cache:

```js
const cut = await handle({operation:'sequence-capture', moduleBase64, entry:'run', args:[4]}, trusted);
const next = await handle({operation:'sequence-advance', moduleBase64, snapshot:cut.snapshot, response:1}, trusted);
// next has snapshot+summary when it reaches another effect,
// or finalMemoryBase64+globals+summary when it actually returns.
const reopened = await handle({operation:'sequence-import', moduleBase64, snapshot:next.snapshot}, trusted);
```

Every cut binds the resolved `{pending:[u32,u32,u32,u32],response:i32}` decision history and cumulative suffix along with complete memory, globals, stack, entry and module identities. Advance first verifies the seal, restores into an independent guest, returns the chosen response at the identical pending arguments, and runs only the new suffix. It may unwind again into a fresh saved continuation. Previous cut objects and sibling instances remain independent. Prefix callbacks remain sealed throughout; use `post_cut` to report work between later effects. Repeated identical pending arguments are allowed because the actual saved execution identifies the suspended call.

A maximum of32 responses may be resolved. An attempted33rd pending effect rejects. History remains bounded to4,096 events; all previous module/accessor/memory/table restrictions apply. The first root capture requires a pending effect; entry returning before any effect is an error. Initializers run before restoration in every fresh instance and cannot invoke the bridge. No new host capabilities are supplied.

Deep import validates the snapshot's bounded shape and module binding, captures the initial program once, advances each declared response on the resulting authenticated continuations, and compares **all** final captured fields excluding the old seal. A history that changes the path, data or stack rejects; a declared history that already returns also rejects. The result reports `importReexecutedPrefix:true` and `importReexecutedDecisions:N`. Subsequent advances do not replay these decisions.

`runSequenceReference(raw,args,responses)` is a controlled-fixture route that runs the original untransformed program uninterrupted with exactly those responses. Missing and unused responses reject, preventing comparisons with a different path. It is not the untrusted worker route.

## Finite counterfactual search

`searchFutures` accepts an actual paused node, a callback that advances it, and a declared response alphabet, baseline, additional decision limit, edge-attempt limit and exact terminal i32 goal. It orders pending edges by change count relative to the supplied baseline. An edge's cost is a lower bound on any completion reachable from it. Therefore a found terminal has a certified minimum only if no cheaper queue edge or unresolved failed/depth-limited edge remains. Equal-cost alternatives need not all be explored to certify the minimum count. A search may reuse already executed edges without running the guest again; its report distinguishes those reuses.

`exhausted` requires an empty frontier, no execution errors, no depth truncations, no budget interruption and no cancellation. A found witness may be minimum within the stated bounds while more equal/higher-cost futures remain. No-match reports do not establish behavior for unlisted responses, more decisions, different inputs or external capabilities. Budget/error reports preserve valid previously accepted nodes but make no completeness claim. Cancellation terminates the current worker and prevents its late result from being accepted.

The sequence server retains at most four modules (8MiB each), four sessions,64 nodes per session,24 recent jobs and two active sequence jobs, within a192MiB logical module/prepared/memory budget. The original workbench's separate64MiB budget remains. Each worker has the existing90-second preparation and30-second guest execution deadlines. CLI exploration bounds retained cuts at128MiB and64 nodes, and omits full terminal memory after deriving actual reports. These are admission limits, not performance guarantees or an operating-system sandbox.

Version2 portable workspaces contain exactly `schema`, `version`, `module`, `snapshot`, `settings` and empty `branches`. They transport a chosen paused cut, not an entire saved tree or a trusted outcome report. The module and complete guest memory may contain private information; exports are voluntary local files. No authentication key or private transform cache is exported. Original version1 workspaces remain supported by the original commands and interface.
