# Fork a JavaScript workflow

This prebuilt QuickJS interpreter runs ordinary JavaScript inside Forkwake's closed WebAssembly guest. A cut preserves actual interpreter frames, closures, graph identity, allocated objects and queued Promise jobs. Loading source needs only the installed Node package. WASI SDK is for rebuilding the interpreter, not for using it.

Use the JavaScript editor at `/futures`, or:

```sh
node cli.mjs capture --script examples/javascript/workflow.js --out first-cut
node cli.mjs explore --script examples/javascript/workflow.js --goal 1 --out search
node cli.mjs explore --script examples/javascript/corrected.js --goal 1 --out corrected
```

The owned example models a transfer with an intentionally faulty timeout policy. It reserves funds, confirms or retries, then publishes a receipt. Two timeouts can leave a debit without a credit. The correction refunds any unconfirmed transfer. It uses a closure, a self-referential account, a Map keyed by that same account, and Promise jobs. These are modeled decisions and ledger values, not real accounts or external services.

## Contract

| Name | Behavior |
| --- | --- |
| `seed` | One signed 32-bit integer input, default 1 |
| `decision(label, payload)` | Suspend inside the interpreter; return a supplied signed 32-bit integer |
| `effect(a,b,c,d)` | Lower-level owned event, four exact signed 32-bit number arguments |
| `emit(text)` | Keep the latest output string, not an append-only log |
| `heapStats()` | Actual requested-allocation counters and limit |
| `resultI32` | Explicit global signed integer ending, for example `globalThis.resultI32 = 1` |

A decision label must occupy 1–96 UTF-8 bytes without NUL. The payload must serialize to JSON within 4,096 UTF-8 bytes. The report records that actual serialized value; JSON serialization may omit undefined properties and invokes ordinary JavaScript serialization hooks. The output admits at most 16,383 UTF-8 bytes. No coercion is accepted for results or low-level effect arguments. Set a top-level `var resultI32`, or `globalThis.resultI32`; a top-level `let` is not a global object property.

Synchronous exceptions, unhandled Promise rejections after pending jobs finish, missing/invalid results and quota interruption are errors. They do not count as successful search witnesses. A rejection handled later by a queued job can complete normally. A script must reach a decision to produce a captured cut. Error messages come from actual guest diagnostics. Unsupported direct host operations fail normally: there are no Node, browser, network, filesystem, timer, std/os or module-loader APIs. Guest clocks and the initial random seed are deterministic; subsequent PRNG state belongs to the guest.

## State and bounds

A reusable interpreter has one fixed active-data slot. Injection admits nonempty valid UTF-8 up to 1,048,575 bytes, with no NUL or unpaired surrogate. It changes only that slot, runs no guest code, and binds source SHA-256 and complete module SHA-256. Exact normalization compares all other code and data against the pinned template. Semantic JavaScript reports are decoded only for that exact template with a valid source slot; other compatible WASM modules remain generic guests.

The custom `JS_NewRuntime2` allocator counts requested bytes using aligned private headers. Its 4 MiB ceiling covers QuickJS allocator requests, not malloc overhead, source storage, interpreter code or the operating system's memory usage. Failed reallocations preserve the original allocation. A separate physical WASM memory maximum is 32 MiB. The interrupt handler rejects after 10,000 callback checks; these are interpreter checks, not an exact instruction count. Preparation and guest execution retain separate 90/30-second terminating worker deadlines. RegExp, compilation and native interpreter work remain subject to those deadlines. Existing finite tree/session/job/retention bounds also apply.

Portable version-2 workspaces include source and full guest state. Import independently re-executes the earlier history once, verifies exact memory/globals/frames, then issues a new seal. Later branches resume without that prefix replay. Workspaces can contain private data and have no automatic publication path.

## Rebuild and attribution

Pristine QuickJS2026-06-04 source and full MIT license are under `vendor/quickjs-2026-06-04/`. `source-manifest.json` records the downloaded archive and each retained pristine file. The exact WASI SDK34 compiler/runtime identity and full runtime notices are retained in `../sqlite/sdk-manifest.json` and `../sqlite/licenses/`. The download hash identifies observed bytes; no independent upstream archive checksum was verified.

```sh
WASI_SDK_PATH=/absolute/path/to/wasi-sdk-34 ./examples/javascript/build.sh
```

The rebuild writes `build/quickjs-template.raw.wasm` and a static-data manifest. Source paths are relative so the binary contains no task-local source paths. The generated build-only dtoa.c replaces one unused setjmp.h include with stddef.h after verifying the original file has no setjmp/longjmp calls. Upstream source bytes remain unchanged. Builds use the upstream Emscripten conditionals for switch dispatch and disabling OS Atomics/C-stack checks; all OS callbacks are closed local stubs. The native/WASM stack is separately bounded.

The shipped template and manifest are pinned by `lib/script-fixture.mjs`. Rebuilds should compare their hashes before substituting them. Intentional bridge/compiler changes require updating the explicit identities, manifest and continuation/control evidence, rather than trusting a filename.

## Optional Origin engine

The default template remains the original engine. `--origin` selects a separate
prebuilt interpreter that captures native caller context at named decisions.
Try `origin-example.js` or Studio's **Load Origin example**. The example models
an unpaid shipment after two payment timeouts; replies remain local values.
See [Origin](../../docs/origin.md) for its portable continuation and source view.

Rebuild the separate variant with:

```sh
WASI_SDK_PATH=/absolute/path/to/wasi-sdk-34 ./examples/javascript/build-origin.sh
```

`prepare-origin.mjs` verifies pristine source bytes, then creates separate build
copies. The QuickJS copy escapes guest-controlled function names in backtrace
text; the dtoa copy uses the existing unused-header compatibility change.
`origin-template-manifest.json` retains exact before/after text and hashes,
bridge identity and the bounded trace layout. Pristine vendor files and the
original template remain unchanged. Capturing metadata allocates; it is opt-in,
may affect quota behavior, and is not causal data flow or full async ancestry.

[QuickJS](https://bellard.org/quickjs/quickjs.html) provides the interpreter and C APIs. [Quickjs-emscripten](https://github.com/justjake/quickjs-emscripten#asyncify) already suspends interpreter execution through Asyncify. Forkwake's integration branches independent live interpreter continuations across repeated owned decisions and searches their actual futures. It does not claim the first interpreter suspension or arbitrary application cloning.

The ending `resultI32` must be an own data property of the guest global object. Getters, setters, inherited values and missing values are rejected. Reading an ending never runs extra guest code after Promise jobs finish.
