# Branch a JavaScript workflow

Write JavaScript and mark decisions where an external response belongs. Forkwake loads it into a shipped QuickJS interpreter compiled to WebAssembly, pauses inside the running interpreter, and resumes its actual stack, heap and JavaScript state in independent branches. No compiler is needed to load a source file.

```js
emit('Starting with seed '+seed);
const reserved=decision('Reserve inventory',{quantity:4});
const paid=decision('Authorize payment',{total:120});
emit('Reservation '+reserved+', payment '+paid);
globalThis.resultI32=reserved===1&&paid===-1?1:0;
```

`seed` is the signed 32-bit `--input` value, defaulting to `1` for a script. `decision(label,payload)` takes a string label and a JSON-serializable payload and returns the supplied signed 32-bit branch response. `emit(string)` updates bounded guest output. Set `globalThis.resultI32` to the final signed 32-bit integer. Missing, out-of-range, or incorrectly typed results and script exceptions are errors, and do not become successful search matches. The guest provides the JavaScript language and these owned workflow functions; it does not provide Node.js, network requests, external files or native process cloning.

Capture a workflow without searching:

```sh
forkwake capture --script workflow.js --out paused
forkwake continue --workspace paused/workspace.forkwake --responses 1 --out payment
forkwake continue --workspace payment/workspace.forkwake --responses -1 --out result
```

Capture saves the actual root paused state in a version-2 `workspace.forkwake`, plus `nodes.json` with its actual output and pending decision. A workflow must reach a decision to create a paused workspace. The first continue above saves a deeper paused state; the second completes the workflow and writes `outcomes.json`. The workspace carries the actual injected module bytes, so later continuation needs neither the original source file nor a compiler. A deep import independently re-executes and verifies every declared earlier choice before issuing a new private seal. Subsequent advances resume without replaying that prefix.

Search for a terminal result with the fewest changed choices within explicit bounds:

```sh
forkwake explore --script workflow.js --alphabet 1,-1 --baseline 1,1 \
  --goal 1 --max-depth 2 --max-jobs 8 --out search
```

This example finds `[1,-1]`, a one-choice change from `[1,1]`. `search.json` records the actual search, declared bounds and coverage limits. `nodes.json` records actual paths, output and terminal values. `minimalWithinBounds` concerns only the given choice set, additional decision depth and executed search frontier. It does not prove arbitrary JavaScript correct or discover production incidents. Failed executions remain explicit failures.

`--script` and `--module` are mutually exclusive. The existing default SQLite example and `--module` workflow keep their input default of `4`. JavaScript source must be valid UTF-8, at most 1 MiB, and satisfy the source loader's validation. Existing output directories are refused. Private directory/file modes, bounded workers, interrupt cancellation, retained-memory limits and private in-memory snapshot keys apply to script workflows too. Workspaces contain source and actual guest memory; protect them when that data is private.

The ending `resultI32` must be an own data property of the guest global object. Getters, setters, inherited values and missing values are rejected. Reading an ending never runs extra guest code after Promise jobs finish.
