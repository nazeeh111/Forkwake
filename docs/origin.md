# Origin: inspect the caller that reached a decision

Origin connects a paused decision to the active JavaScript callers supplied by
the interpreter. It is useful when a timeout reaches a surprising retry or
dispatch path: select that saved moment and inspect its actual caller lines.
The code excerpt always comes from the captured module, including after edits
to the editor draft or a portable reopen.

## Try the checkout

Open `/futures`, choose **Load Origin example**, then capture. That choice enables
the optional Origin checkbox. The closed checkout models inventory, payment,
retry and dispatch replies locally; no real vendor or payment is contacted.
Positive seed selects the deliberately faulty policy, negative seed its correction.

Respond `1` to inventory, `-1` to payment, `-1` to its retry, and stop before
dispatch. Select **Origin**: the actual stack contains `callVendor`,
`dispatchOrder` and `checkout`, with source coordinates. Click a mapped frame to
inspect the captured source. Respond `1` to dispatch to reproduce the unpaid
shipment. The terminal record labels these callers as **last captured context**,
not a still-active stack or a complete explanation of the output.

```sh
node cli.mjs capture --script examples/javascript/origin-example.js --origin --out first-cut
node cli.mjs continue --workspace first-cut/workspace.forkwake --responses 1,-1,-1 --out before-dispatch
node cli.mjs continue --workspace before-dispatch/workspace.forkwake --responses 1 --out unpaid-shipment
node scripts/check-origin.mjs before-dispatch/outcomes.json unpaid-shipment/outcomes.json
```

The saved module carries the source and selected engine. Reopen does not require
the original `.js` file or a compiler. It reconstructs the earlier responses once
and verifies the actual cut before resealing, then resumes the saved continuation.

## Turn the witness into a test

The [timeout regression recipe](timeout-regression.md) runs the discovered
`1,-1,-1,1` path as a failing `node:test` assertion, then runs the corrected
policy with the same invariant. It retains actual CLI artifacts and source-bound
callers for inspection.

## Explicit opt-in

`--origin` works only with `--script`. Existing CLI commands and HTTP requests
without Origin keep the exact original 0.3 interpreter. `loadScriptModule` takes
`{name, origin: true}`; `/api/sequence-script` accepts an optional strict boolean
`origin`. Portable import determines the engine from its recognized bytes, not
a caller's unchecked flag or an arbitrary memory address.

Capturing stack metadata allocates temporary guest data. It may affect garbage
collection and behavior near a memory quota. An allocation failure reports
unavailable metadata where the decision can still proceed. This is not a
universally passive observer. Leave tracing off when comparing exact original
allocator behavior.

## What the record means

`report.origin` binds its source SHA256, engine template SHA256 and pending
ordinal. `state` is captured, unavailable or truncated; `lastDecision` labels a
terminal's last captured context. `rawText` contains the bounded trace; `frames`
contains at most 64 parsed frames. Inspect the record's context and reason for
an unavailable trace. An unrelated raw `effect` clears the old decision context.

Only valid `script.js` coordinates within the captured source are mapped. Dynamic
`eval`/`Function` code and native frames remain unbound. QuickJS columns describe
interpreter debug positions, which can anchor a statement rather than the exact
call token. They need not match V8 columns.

Names are interpreter display text that a program can change. The Origin engine
escapes control characters, parentheses and backslashes in those names before
formatting a trace, so a malicious display name cannot inject another apparent
frame. The UI displays them as text. It does not treat them as trusted identifiers.

After an `await`, a prior Promise scheduling frame may no longer be present.
Returned closure creators are absent too. Origin does not recover full async
ancestry, captured-value provenance, causal data flow or line coverage.

## Engine and limits

Origin uses native QuickJS C APIs to create and consume a temporary error, then
read its own stack data property without executing user getters. User source is
not rewritten and the global `Error` constructor is not wrapped.

The pristine QuickJS sources remain retained. The build produces a generated
compatibility copy with one narrow change to function-name escaping in the
backtrace formatter. The origin manifest records that change and source identity.
See `examples/javascript/build-origin.sh` and `prepare-origin.mjs`; the end-user
source-loading path uses the prebuilt engine and needs no compiler.

The copied trace admits 4095 UTF-8 bytes plus a terminator. A clipped incomplete
frame is not mapped. QuickJS may construct a larger temporary backtrace before
that copy; the existing 4 MiB requested allocator quota, 32 MiB physical memory
maximum and worker deadlines still apply. No new universal correctness, security,
latency or cross-platform hard-memory guarantee follows from these controls.
