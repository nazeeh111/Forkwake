# Current JavaScript and Origin walkthrough

The README animation contains three actual Chrome interface captures from the
installed local Forkwake server. It is a sequence of held frames, not real-time
screen recording. Preparation, search time and navigation are omitted. Only the
outer title strip and image scaling are generated; interface values and text
are unretouched. Static desktop and narrow images are available beside it.

## Reproduce the computation

Node 20+ and the declared Binaryen 132.0.0 dependency. No compiler, credentials,
account, model API, vendor requests or real orders are involved.

```sh
npm ci --ignore-scripts
npm start
```

Open `/futures` at the printed loopback address. Choose **Load Origin example**.
This loads `examples/javascript/origin-example.js` and enables **Capture decision
callers**. Keep seed `1`, then **Load and capture script**. The first pending
request is `inventory`. Capture runs actual code; allow its declared preparation
deadline rather than treating a still-running job as a result.

Search from that initial cut with response alphabet `1,0,-1`, preferred path
`1,1,1,1`, additional decision limit `4`, execution budget `128`, terminal return
`1`. This captured run executed 16 futures, retained 17 moments, reached 11 terminal
endings, and found `[1,-1,-1,1]` with two changed decisions and zero failed
executions. Minimality is within those declared bounds. Two futures remained
unexpanded: the search did not exhaust the space.

Select the found ending. **Origin** shows the historical callers at its last
captured decision, including `callVendor`, `dispatchOrder` and `checkout`.
Selecting `dispatchOrder` maps to source line 19. These are historical callers,
not currently executing frames or full causal data flow. **Outcome** shows the
actual JSON with `reserved:true`, `paid:false` and `dispatched:true`.

For a corrected control, load the same Origin source with seed `-1` and repeat
from its initial cut. Do not reuse an old selected ending as a new search root.
The screenshot sequence does not depict that corrected control. The unchanged
existing JavaScript HTTP test separately verifies the shipped transfer example's
faulty and corrected response trees. Full engine evidence remains in the existing
test suite and contracts; this presentation change introduces no new engine claim.

## Capture and build the assets

Use the actual browser interface at 1440×1000 and 390×844, without modifying its
DOM, values or results for display. Keep source and tree visible for the desktop
view. On the found ending, capture Origin with `dispatchOrder` selected, then
Outcome. Copy the unretouched JPEG captures to `frames/{tree,origin,outcome}.jpg`.
Capture the **Execution tree** jump link as `../futures-mobile-tree.jpg`.
`../futures-mobile.jpg` is an identical alias of that narrow tree capture; a
separate narrow opening image is not bundled. Reset the browser viewport
after inspection. Long source lines and tree columns scroll inside their own
areas; the page itself should fit 390px.

Build the held-frame animation using an existing Pillow installation:

```sh
python scripts/build-presentation.py
```

Pillow is only an optional media build dependency. Arial from the local system is
used for the outer titles when present; otherwise the generator uses Pillow's
built-in font. No font file is bundled. The public code/input/assets and their
SHA-256 identities are in `SOURCE.json`. An independent capture may change pixel
hashes because browser/font/device rendering differs. The original 0.1 SQLite
single-cut screenshot remains at `../workbench.png`; it is no longer the primary
image for the current JavaScript workflow.
