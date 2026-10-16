# Turn a timeout witness into a regression test

A timeout means the payment result is unknown. It does not mean the order is
paid. This worked example takes one failing checkout path, inspects the callers
that reached dispatch, and makes the same path fail a normal Node test.

The example uses Forkwake's authored checkout, not a real payment integration.
Its deliberately faulty rule allows dispatch after two payment timeouts. The
corrected rule requires `ledger.paid`. Both policies are in the same
[small source file](../examples/javascript/origin-example.js), selected by the
sign of the input seed.

## Reproduce the failure

Start in a Forkwake checkout with its declared dependency installed and Node.js
20 or newer. The [standard setup](../README.md#run-it) uses `npm ci --ignore-scripts`.
The recipe uses Node's built-in test runner and requires no extra test library.

```sh
FORKWAKE_RECIPE_POLICY=faulty \
FORKWAKE_RECIPE_OUT="$PWD/timeout-faulty" \
node --test examples/javascript/regression/timeout-regression.test.mjs
```

This command should fail with **Unpaid dispatch after replies 1,-1,-1,1**.
The replies mean inventory accepted, payment timed out, retry timed out, dispatch
accepted. Inspect `timeout-faulty/regression-receipt.json`:

```json
{
  "replies": [1, -1, -1, 1],
  "ledger": {"reserved": true, "paid": false, "dispatched": true},
  "invariant": {"name": "dispatch requires confirmed payment", "passed": false}
}
```

This is a shortened excerpt. The actual receipt includes all attempts and caller
frames. It is generated from the completed guest execution before the assertion.

## Inspect why that path reached dispatch

Before giving the fourth reply, the recipe saves a paused continuation in
`timeout-faulty/after-timeouts/workspace.forkwake`. Its accompanying
`outcomes.json` records the active `dispatchOrder` and `checkout` frames.
`sourceBound: true` means their coordinates map into the captured source.
The receipt binds that exact source with SHA-256; `captured-source.js` retains it.

The important branch in the example is:

```js
if (ledger.paid || (seed > 0 && paidReply === -1)) dispatchOrder(order);
```

The second condition mistakes an unknown payment result for permission to ship.
Origin makes the reached callers inspectable. It does not establish causal data
flow or recover Promise scheduling frames that already returned. A terminal
record contains the last captured decision context, not an active stack.

## Keep the corrected path in your test command

```sh
FORKWAKE_RECIPE_OUT="$PWD/timeout-corrected" \
node --test examples/javascript/regression/timeout-regression.test.mjs
```

This should pass. The default selects the corrected policy. After the first
three replies it ends with `paid: false`, `dispatched: false`, and never requests
dispatch. The test asserts the same business rule in both runs:

```js
assert.ok(!ledger.dispatched || ledger.paid);
```

For your own workflow, replace the authored checkout with a small model of the
real decision boundary. Use your discovered replies and assert the business rule
over its output. Keep the trace as debugging evidence alongside that assertion;
function display names alone are not a business-rule check.

Each output directory must be new. A repeat refuses existing evidence. The
recipe retains every CLI command's stdout/stderr, source, portable cuts, ending
and receipt so a failed test can be inspected. Portable import re-executes the
earlier history once to verify the cut before resuming it. These files can
contain workflow data; keep real private data out of public artifacts.

This checks one concrete timeout path. It does not prove every ordering safe,
exercise a payment API, reproduce real network scheduling, or validate a
production system. For broader bounded exploration, use the
[search guide](javascript-cli.md) and read its unresolved-work counts.

Written and verified with Codex. Node's official
[test runner documentation](https://nodejs.org/docs/latest-v24.x/api/test.html)
describes `node --test`; Forkwake's [Origin contract](origin.md) describes the
captured callers and portable continuation used here.
