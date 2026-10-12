# JavaScript futures

The next delivery removes a practical obstacle in Forkwake: custom workflows should not need a C compiler. A pinned, prebuilt QuickJS interpreter owns the JavaScript heap, aliases, closures, pending Promise jobs and call stack inside one bounded WebAssembly guest. Forkwake's existing continuation mechanism preserves that interpreter state at each explicitly owned decision.

This follows the successful official QuickJS source proof, including original raw execution controls. Existing quickjs-emscripten already suspends interpreters with Asyncify. The new product combines a closed reusable interpreter, independently branched continuations, named decisions, finite minimum-change search and portable deep cuts. No first-invention or arbitrary Node application claim is made.

Alternatives considered were integrating the established host-heavy quickjs-emscripten module, rewriting user code into a serializable state machine, and keeping per-script C compilation. The reusable closed interpreter keeps ordinary object identity and suspended interpreter frames with the smallest change to the validated guest boundary. It needs a strict source slot, exact template binding, measured allocation accounting and actionable guest errors before product delivery.

## User contract

A UTF-8 script sees `seed`, `decision(label, payload)`, `effect(a,b,c,d)`, `emit(text)`, `heapStats()` and normal supported QuickJS language intrinsics. `decision` returns a supplied signed 32-bit integer. `emit` keeps the latest bounded string. A script sets `globalThis.resultI32` or top-level `var resultI32` to an exact signed 32-bit integer when its pending jobs finish. Return 1 can represent a violated user rule, 0 a passing ending, or users can choose another exact search goal.

The named request label and JSON payload are actual guest data at the pending cut. They do not call remote services. The host exposes no network, filesystem, Node, browser, timers or module loader. Guest clock and initial random state are deterministic; neither establishes real-time behavior. Scripts completing before a decision get a clear capture error. Unhandled Promise rejection, syntax/runtime errors, missing or coercible results, exceeded output/label/payload bounds and quota interruption must never become successful search witnesses.

The prebuilt source slot admits at most 1,048,575 UTF-8 bytes, nonempty with no NUL or unpaired surrogate. Injection changes only that fixed active-data region. Exact normalization binds every remaining executable and data byte to the trusted interpreter, and each workflow binds the exact source hash and complete module hash. Workspace v2 retains the same shape and contains those actual module bytes. Portable import independently executes and verifies earlier declared decisions before resealing.

QuickJS allocator callbacks account for requested allocation bytes with a 4 MiB ceiling. This excludes libc allocation overhead, the source region, interpreter binary and whole worker memory. WebAssembly has a separate 32 MiB maximum. Instruction interrupts and terminating execution workers provide additional bounds; they are not a universal memory-safety proof. Existing sequence budgets remain in force.

## Acceptance

Use two materially different scripts injected without compiler or guest execution. Compare all selected terminal branches, output/status/request data and histories with original raw module execution. Challenge closures, cyclic identity, typed arrays, BigInt, generators, async jobs, negative i32 boundaries, interior sibling independence and new-key deep import. Test strict source binding and encoding, quota failure/recovery, unhandled rejection and runtime errors before and after cuts. Execute a finite faulty/corrected conservation-rule example, installed CLI and actual source editor/search/inspection in the browser. Preserve original SQLite and generic WASM flows.

Parent owns helper/service/runtime observation/fixtures/licensing/package. CLI and UI agents own disjoint product files. Fresh review should challenge source normalization, diagnostics versus search outcomes, allocator accounting and interface behavior using current artifacts and controls. Preserve scratch proof bytes separately. Ship only after relevant local/hosted and fresh installation checks.

The ending `resultI32` must be an own data property of the guest global object. Getters, setters, inherited values and missing values are rejected. Reading an ending never runs extra guest code after Promise jobs finish.
