# Forkwake user guide

**Branch a live JavaScript decision. Find the response sequence that breaks your rule.**

Capture a workflow at a named decision, then resume its live state with different
answers. Explore the resulting execution tree, compare actual outputs and inspect
the callers recorded at a decision. The program runs in a closed local guest:
external effects are controlled integer replies, not live service calls.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="futures-workbench.jpg">
  <img src="futures-walkthrough.gif" alt="Actual installed Forkwake interface: explore the authored checkout's response tree, inspect recorded dispatch callers, then read output with paid false and dispatched true.">
</picture>

*Actual installed interface, three held frames with preparation and navigation
omitted. The intentionally faulty owned checkout reaches unpaid dispatch after
responses `1, -1, -1, 1`. This is a diagnostic example, not an external order or a
newly discovered third-party defect. [Static desktop view](futures-workbench.jpg),
[narrow tree view](futures-mobile-tree.jpg), [input and capture recipe](demos/README.md).*

## Try it

Node.js 20 or newer. No API key, account, native runtime compiler or external service is needed.

```sh
git clone https://github.com/nazeeh111/Forkwake.git
cd Forkwake
npm ci --ignore-scripts
npm start
```

Open `/futures` at the printed loopback address. The JavaScript editor loads a deliberately faulty transfer example: two timeout responses can debit an account without crediting its recipient. Capture it, search for return `1`, and inspect the actual named requests and emitted ledger. Load the corrected version to compare the declared response tree. The seed is a signed integer input; `emit(text)` keeps the latest output string and `resultI32` supplies your terminal search result. A script error is an execution error, never a successful witness.

The SQLite example remains available at the same printed address, normally `http://127.0.0.1:6350`, and follow **Sequential futures**. Load the fulfillment example, capture input `4`, and find return `1` using choices `1,0,-1`, baseline `1,1,1,1` and four additional decisions. The witness `[1,-1,-1,1]` changes two decisions from that baseline. Inspect the real shipment and missing receipt. Repeat with corrected input `-4`: all eleven terminal futures in that declared tree return `0`. You can also advance any paused node manually and compare actual memory and history. The original one-event workbench remains at `/`.

The first capture rewrites the compiled module with Binaryen Asyncify. Later branches reuse the validated transformation and create fresh guest instances. On the development Mac, the 1.17 MiB SQLite module took about 13 seconds to capture and a cached fork about 0.24 seconds. These are example measurements, not a performance guarantee. The hosted Mac runner took about 41 seconds to prepare the same workload. Preparation has a separate 90-second deadline; guest initialization, execution and result capture have a 30-second deadline. Jobs can be cancelled during either phase.

## What the cut preserves

Forkwake saves the suspended call stack, linear memory, mutable integer globals and owned event history. Each branch restores that state into an independent guest instance and resumes the pending call. It does not restart the program and feed it different inputs.

Write ordinary JavaScript with `decision("Confirm transfer", {amount: 25})`. Forkwake runs it in a prebuilt QuickJS interpreter and preserves the interpreter's live memory and suspended stack. Closures, cyclic object graphs, Map keys and queued Promise jobs survive each branch. Your workflow needs no C compiler or rewrite into a state machine. JavaScript runs inside an explicitly closed guest, with no Node, browser or network APIs.

The sequential example pauses **inside SQLite's SQL engine** at reservation, payment, retry and dispatch decisions. Its open transaction, two busy prepared statements, nested C locals, heap and unfinished SQL expression survive repeated cuts. A deliberately faulty timeout policy can ship an order without a receipt; its correction stops that path. The search finds the actual response sequence and reports the declared search space, coverage and unresolved work. This is an owned demonstration, not a newly discovered SQLite defect. The original single-event payment example remains available.

## Your own JavaScript

```js
var resultI32;
const state = { balance: 100 };
const receipt = decision("Payment", { amount: 25, balance: state.balance });
if (receipt === 1) state.balance -= 25;
emit(JSON.stringify(state));
resultI32 = state.balance < 0 ? 1 : 0;
```

```sh
node cli.mjs capture --script ./workflow.js --out ./first-cut
node cli.mjs continue --workspace ./first-cut/workspace.forkwake \
  --responses 1 --out ./approved
node cli.mjs explore --script ./examples/javascript/workflow.js \
  --alphabet 1,0,-1 --baseline 1,1,1,1 --goal 1 --max-depth 4 --out ./transfer-search
```

Source is bound to the exact prebuilt interpreter and its own SHA-256, including portable cuts. Script loading patches one bounded data slot and executes no guest code. Source must be valid UTF-8, at most 1,048,575 bytes, with no NUL. Decision labels admit 96 UTF-8 bytes and JSON payloads 4,096. The latest output admits 16,383 UTF-8 bytes. The allocator enforces 4 MiB of requested QuickJS allocation bytes, separately from the guest's 32 MiB physical memory maximum and terminating worker deadlines. Clock values and the initial random state are deterministic. External effects are explicit modeled decisions, not live remote calls. [JavaScript contract and rebuild](../examples/javascript/README.md) and [CLI details](javascript-cli.md) explain errors and limits.

## Origin: connect a decision to its callers

Enable **Origin** before capture, or choose **Load Origin example** in the
JavaScript editor. Select a saved decision and open the **Origin** evidence tab:
inspect its actual interpreter callers and click a mapped frame to see the
captured source. Compare two futures without losing an edited source draft.

The checkout example makes the need concrete: two payment timeouts reach a
dispatch path that should have required payment. The inspector shows the callers
at that pending dispatch; continuing produces the actual unpaid-shipment result.
Negative seed selects the corrected rule.

```sh
node cli.mjs capture --script examples/javascript/origin-example.js --origin --out checkout-cut
node cli.mjs continue --workspace checkout-cut/workspace.forkwake --responses 1,-1,-1 --out dispatch-cut
```

Origin is opt-in. The default keeps the exact original interpreter. Trace records
bind the executed source and engine, retain unavailable/truncated states and
escape guest-controlled names. Finished nodes show the last captured context.
Dynamic code stays unmapped. Metadata can consume extra guest memory and affect
quota/GC behavior; caller stacks do not establish causal data flow or full async
ancestry. [Origin contract and portable walkthrough](origin.md).

## Search and continue outside the browser

```sh
node cli.mjs explore --input 4 --goal 1 --out ./fulfillment-search
node cli.mjs explore --module ./examples/fulfillment/workflow.raw.wasm \
  --input -4 --goal 1 --out ./corrected-search
node cli.mjs continue --workspace ./fulfillment-search/workspace.forkwake \
  --responses 1,-1,-1 --out ./paused-before-dispatch
node cli.mjs continue --workspace ./paused-before-dispatch/workspace.forkwake \
  --responses 1 --out ./reproduced-failure
```

`explore` orders concrete executions by the number of responses differing from the explicit baseline. It reuses saved continuations and existing verified edges. `search.json` records scope and coverage; `nodes.json` contains actual execution summaries and actual JavaScript output and named requests, or interpreted SQL rows for the exact owned example. A minimum is claimed only when cheaper possibilities have been resolved. A budget limit, execution error or unresolved depth boundary prevents the corresponding guarantee. No match means only what the completed declared search establishes.

Version2 workspaces export **one chosen paused cut**, including its exact resolved history. Import runs the root prefix once, then executes that history and demands identical memory, globals and saved stack before resealing. It does not accept saved outcomes as evidence. `continue` advances that validated cut; it saves a new cut if still paused or the actual terminal outcome if finished. The interface can export and reopen the selected paused node, including deep cuts.

The response alphabet supports up to five distinct signed integers, search depth up to32 total decisions, and at most128 edge attempts per search. These are explicit finite bounds, not symbolic execution or universal application proof. [Engine details](../README_engine.md) and [the real SQLite workload](../examples/fulfillment/README.md) explain the contract and deliberate defect.

## Original single-cut commands

```sh
node cli.mjs demo --out ./sqlite-futures
node cli.mjs run --module ./examples/continuation/fixture.raw.wasm \
  --input 4 --responses 1,0,-1 --out ./c-futures
node cli.mjs resume --workspace ./sqlite-futures/workspace.forkwake \
  --responses 2,-2 --out ./more-futures
```

Output directories must be new. `workspace.forkwake` contains the original module, captured state and branch responses. `outcomes.json` records actual results, traces, restoration checks, hashes and memory changes. Add `--memory` to save each branch's final memory as a binary file. Neither export contains the runtime's private authentication key.

Save and reopen a workspace in the interface too. Reopening **independently executes the prefix once to validate the cut**, comparing the recaptured bytes, globals, stack and history. It then executes saved branches again. Reported outcomes and old authentication seals are never accepted as evidence. Subsequent forks resume the validated cut without prefix replay. A browser refresh reads an existing live session from the server without executing the guest; a server restart requires reopening an exported workspace.

Workspaces include the guest's complete memory. Keep them private if the program contains private data. Forkwake has no telemetry, automatic upload or sharing endpoint.

## Bring your own program

This version accepts a **closed wasm32 guest**: a WebAssembly program with one owned memory and an explicitly controlled event boundary. It does not clone native processes, open files, sockets or arbitrary applications. The boundary is small enough to make state restoration explicit and testable.

Required exports:

| Export | Type | Purpose |
| --- | --- | --- |
| `run` | `(i32) -> i32` | Entry point with one signed integer argument |
| `memory` | owned unshared wasm32 memory | Explicit maximum, at most 32 MiB |
| `header_address` | `() -> i32` | Address of reserved Asyncify storage |
| `asyncify_capacity` | `() -> i32` | Reserved storage size including an 8-byte header |

Allowed imports:

| Import | Type | Behavior |
| --- | --- | --- |
| `env.pre_cut` | `(i32, i32) -> void` | Optional opaque prefix event |
| `env.pending_effect` | `(i32, i32, i32, i32) -> i32` | Suspends; each branch supplies its response |
| `env.post_cut` | `(i32, i32) -> void` | Optional opaque suffix event |

Only `pending_effect` is required. Its four arguments are captured as unsigned bit patterns and must match when the stack rewinds. The original single-cut commands reject a second pending event. Sequential operations capture it and allow up to32 resolved decisions. Prefix events are allowed only before the first cut; use suffix events for work between later decisions. Use the included freestanding C example as a complete integration reference; the SQLite example shows a much larger unchanged library running through this boundary. Both include source and build recipes. Building examples requires the free official WASI SDK, not running them. For example, set `WASI_SDK_PATH` to the SDK root and run `sh examples/sqlite/build.sh`. To preserve the supplied binary, set `FORKWAKE_BUILD_OUT` to a new directory ending in `workflow.raw.wasm`. The compiler records the output basename in a WebAssembly name section, so other basenames change its hash even when executable sections are identical.

The two storage accessors must be pure, bounded functions. Forkwake statically checks their complete owned call graph before execution. Constants, locals, global reads and nontrapping scalar arithmetic are supported; memory loads/writes, imports, growth, loops, recursion and other unsupported forms reject. Optional `_initialize()` runs in fresh instances before restoration and cannot call the bridge. A module start function rejects.

Fixed private function tables are supported and reconstructed from the same module in each instance. Imported/exported/mutable tables, shared/imported/multiple memories, memory64, passive segment state and unowned imports reject. Classification is conservative, including unreachable unsupported code. Modules are capped at 8 MiB, Asyncify storage at 1 MiB, event history at 4,096 records. The original workbench retains at most four modules, four cuts and twelve branches within a64MiB logical data budget. Sequential work has separate bounded node/session storage; export a paused cut and restart when full. See [the engine contract](../README_engine.md) for exact restoration and authentication details.

## What establishes the result

```sh
npm test
```

Tests compare resumed compiled C and SQLite executions with uninterrupted original-module controls, including both repeated controls and sibling isolation. SQLite comparisons include every exported result word and actual JSON query rows. All24 terminal fulfillment paths are compared with original-module controls. Independent sequence probes cover repeated identical effects, variable path lengths, 32 decisions and rejection of a33rd, deep imports and worker loops. Search checks distinguish proven finite minima, complete no-match enumeration and unresolved budgets/errors. The suite also checks exact i64 global restoration, memory growth, nested frames, sealed prefix callbacks, portable import revalidation, forged cuts/caches, side-effecting storage accessors, unsupported modules, HTTP write boundaries and cancellation. CLI tests exercise packaged workflows and reject invalid input and overwrite attempts.

Origin tests compare closure and Promise caller lines with V8, preserve origins
across sibling forks and portable import, and check hostile display names,
getter avoidance, unbound dynamic code, clipping, quota pressure and corrupt
metadata. The unchanged default template is checked separately. The checkout
demo matched 24 distinct finite response paths across untraced QuickJS, Origin
QuickJS and V8; its corrected policy had no unpaid shipment in that set.

The saved SQLite frame is 484 bytes; the complete captured memory is 4 MiB. The fixture separately reports actual SQLite allocation and a 64 KiB allocated canary. These are different measures. Restoration checks and these controls are runtime evidence on the shipped cases, not a proof of every possible Asyncify transformation or application equivalence.

The SQLite guest's file interface is an owned memory-only implementation. External file opening/deletion is denied; its clock and random source are deterministic guest state. No WASI filesystem, network or host-clock capability is supplied. Cancellation prevents unfinished results from being accepted. Run untrusted modules only inside the bounded worker route, never by directly calling the synchronous engine in a long-lived host process.

## Foundation and contribution

Binaryen's [Asyncify](https://kripken.github.io/blog/wasm/2019/07/16/asyncify.html) provides the established stack transformation. Forkwake adds the closed guest contract, authenticated portable cuts, actual sibling restoration, independent import checks and an inspection workflow around it. Execution forking and multiverse debugging have prior art; this project claims no first invention.

Original code is MIT. SQLite source is unchanged public-domain code; Binaryen is Apache-2.0. Official source identities and build provenance are included. See [third-party notices](../THIRD_PARTY_NOTICES.md).

Useful contributions include a public closed guest whose fork disagrees with an uninterrupted control, another reproducible workload, or a specific ABI limitation with a small compiling example. Do not upload proprietary programs or private memory dumps.

The ending `resultI32` must be an own data property of the guest global object. Getters, setters, inherited values and missing values are rejected. Reading an ending never runs extra guest code after Promise jobs finish.
