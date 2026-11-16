# Search and continue from the command line

`explore` executes actual branches and searches for a terminal return value. It prioritizes the number of responses changed from the declared baseline; this is a concrete search cost, not a claim that it has inferred causality or proven an arbitrary program correct.

```sh
forkwake explore --input 4 --alphabet 1,0,-1 --baseline 1,1,1,1 \
  --goal 1 --max-depth 4 --max-jobs 128 --out new-search
```

The default module is the owned compiled SQLite fulfillment example. Positive quantity selects its deliberately faulty policy; negative quantity selects its corrected policy. Other compatible modules can be supplied with `--module /path/to/program.wasm`. Defaults are input `4`, alphabet `1,0,-1`, maximum additional depth `4`, goal `1`, and maximum edge attempts `128`. An omitted baseline repeats the first alphabet choice once per additional decision. An explicit baseline must have exactly that length, and every baseline choice must belong to the alphabet.

The output contains:

- `workspace.forkwake`: the real root paused state, with the module bytes and captured memory.
- `nodes.json`: actual decision paths, summaries, returns, and SQL reports for the recognized owned fixtures. Arbitrary guest outcomes remain opaque.
- `search.json`: bounds, actual attempts, terminal counts, coverage limits, and any witness. `minimalWithinBounds` refers only to the declared alphabet, additional depth and executed frontier; unresolved lower-cost failures prevent that claim.

There are at most five distinct signed 32-bit choices, 32 additional decisions, 128 edge attempts, 64 node records and 128 MiB of retained guest memory. Memory from completed outcomes is discarded after extracting actual reports and hashes. A parent's saved memory is released once all its alphabet edges have been attempted. Bound-limited or failed searches explicitly report incomplete coverage.

`continue` resumes a single sequence, rather than generating siblings from one cut:

```sh
forkwake continue --workspace new-search/workspace.forkwake \
  --responses 1,-1 --out payment-retry
forkwake continue --workspace payment-retry/workspace.forkwake \
  --responses -1,1 --out shipped-outcome
```

The first example stops at a deeper paused state and writes its version-2 `workspace.forkwake`. The second independently imports that state, resumes the remaining two decisions, and writes the actual final `outcomes.json`. A deep import re-executes and verifies the original prefix and every declared earlier decision before issuing a new private seal. Later advances restore that verified continuation without replay. Every supplied response must be consumed; extra responses after completion are an error. A completed continuation has no paused workspace to export.

Both commands refuse existing output directories and use private directory/file permissions. Snapshot keys and trusted transform caches remain in memory; exports never contain them. Workspaces contain actual guest memory and can contain private program data, so keep them private when the input data is private. Interrupt signals terminate the active worker. Every job has separate 90-second preparation and 30-second execution deadlines. Partially written owned exports remain available for inspection; existing user files are never replaced.

The original `run`, `resume`, `demo`, and `serve` commands remain available. Version-1 `resume` remains the original sibling-branch workflow; version-2 sequential workspaces use `continue`.

## Pause the search, then resume its frontier

A budget-limited `explore` now also publishes `search.forkwake`. Resume into a new
directory, with a fresh per-invocation edge budget:

```sh
forkwake explore --input 4 --alphabet 1,0,-1 --baseline 1,1,1,1 \
  --goal 1 --max-depth 4 --max-jobs 2 --out first-search
forkwake explore-resume --checkpoint first-search/search.forkwake \
  --max-jobs 128 --out continued-search
```

The artifact contains the source/root workspace, validated-outcome node records,
ordered frontier node identifiers, insertion serial, unresolved costs, fixed
settings and a bounded attempt transcript. `explore-resume` uses those immutable
settings. Only the new 1–128 edge-attempt budget changes. Depth remains relative
to the original root, not the latest invocation. No script/module source file is
needed after export; its bytes remain inside the root workspace.

On process restart, the existing independent `sequence-import` validates and
re-seals the root. The existing `sequence-advance` reconstructs every recorded
node before any handle is admitted. This validation costs at most 64 jobs for the
64-node record limit and is reported as `actual.validationJobs`, separately from
`actual.newWorkerJobs`. These jobs can be expensive; portable recovery does not
claim zero replay or a performance improvement. New attempts restore validated
pending cuts without replaying their preceding decisions. Existing worker
preparation/execution deadlines still apply to every job. Overall elapsed time
is not bounded by `maxJobs` alone.

The search layer rebuilds its priority queue from the attempt transcript using
those validated handles and compares the saved frontier and unresolved bounds.
It does not trust a saved witness/minimum flag. Duplicate/omitted/reordered edges,
missing handles, changed root/module/entry arguments or fixed search settings,
and corrupt data refuse. Hashes detect corruption, not authorship; this is not a
signed receipt. Failed owner operations remain conservative unresolved lower
bounds, not proof that a retry would fail again. They are not retried by search
resume and can prevent minimum/exhaustion claims indefinitely. Start a new search
if you intentionally want different bounds or failure-retry semantics.

`search.executed` and `reused` concern this invocation. `totalExecuted`,
`totalReused`, terminal/depth/failure counts and errors cover the carried search.
`state` is `matched`, `exhausted`, `unfinished` or `refused`; always read
`minimalWithinBounds` separately. A match is an actual validated terminal; a
lower-cost unresolved failure/depth edge still prevents a minimum claim. No
witness with unfinished work is not an absence proof. Cancellation keeps an
in-flight edge pending for retry rather than deleting cheaper work. The general
search record also has a4096-attempt/frontier limit; hitting it is refusal, never
exhaustion. CLI/server node and retained-memory budgets remain tighter.

Only a fully written, fsynced checkpoint is linked to its final exclusive path.
The original checkpoint is never replaced; each invocation requires a new output
directory. A handled write failure removes its owned `.pending` staging file.
Other partial report files may remain for inspection but are not checkpoints.
SIGINT/SIGTERM stop the active worker; once a root exists, a cooperative search
stop exports the unfinished checkpoint and exits130/143. A hard kill can lose the
current invocation and leave a `.pending` file; resume the preceding valid
checkpoint. Checkpoint JSON is bounded to96MiB; root/modules/memory keep their
existing limits. Memory accounting covers retained search cuts including the
root workspace, not caller-held exports, input JSON or transient serialization.
The artifact contains source and actual guest data, but no private snapshot key
or trusted transform cache. Keep it private when its guest data is private.

Library API (installed package):

```js
import {searchWorkspace, encodeSearchWorkspace} from 'forkwake/lib/search-workspace.mjs';
const first = await searchWorkspace({bytes, name:'owned.wasm', input:4, settings});
// Save encodeSearchWorkspace(first.checkpoint) using an exclusive output path.
const continued = await searchWorkspace({bytes, name:'owned.wasm', prior:first.checkpoint,
  settings:{...first.checkpoint.checkpoint.settings, maxJobs:128}});
```

The lower-level `searchFutures` accepts `sourceIdentity`, `checkpoint` and an
owner-supplied `resolveNode(id)` returning validated handles. Do not use untrusted
serialized summaries as that resolver. `continuationIdentity` excludes only the
private seal so a fully validated portable cut retains its identity after
re-sealing. It is not a replacement for runtime validation.

The existing local HTTP service now supports `operation:"search-resume"` with
`sessionId`, original `nodeId` and `maxJobs`, and exposes the same-session search
record at `/api/sequence-searches/<sessionId>`. One search owns each sequence at a
time. These identifiers belong to the running service; they are not a portable
CLI workspace. Use the CLI or library portable artifact for process restart.
There is no new browser control and no fresh native-rendered acceptance claim.
