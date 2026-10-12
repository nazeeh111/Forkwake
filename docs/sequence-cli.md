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
