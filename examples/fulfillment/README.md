# Fulfillment: a live SQL fault search

This is an owned demonstration program with a deliberately faulty policy. It is not a discovered SQLite defect or an upstream production incident. The SQL engine is the unchanged official SQLite 3.54.0 amalgamation already shipped in `../sqlite/`.

The program opens an in-memory database, starts an immediate transaction, and asks for inventory reservation, payment authorization, then dispatch. Each question is a registered SQL function called by SQLite's virtual machine during `sqlite3_step`. At each pause the transaction is open, a separate catalog cursor remains busy, the current decision statement remains busy, and nested C locals and actual SQLite heap allocations remain live. The final report is produced by real SQL queries and read from guest memory. No response-to-outcome lookup substitutes for execution.

Inputs `4` and `-4` both order four widgets from twelve in stock. Positive input selects the deliberately faulty policy. Negative input selects its corrected counterpart. Nonzero quantities up to 1,000,000 are accepted, with an actual inventory rejection above available stock. Zero, `INT32_MIN`, and larger magnitudes trap. The demonstration interprets `1` as approval, `0` as denial, and `-1` as timeout. Other responses fail closed with a timeout/error status and do not trigger the deliberately faulty timeout exception; supported search choices are the three named values.

| Pending effect | Meaning | Next behavior |
| --- | --- | --- |
| 901 | Reserve inventory | Rejection or timeout finishes early; approval checks real stock and reserves it. |
| 902 | Authorize payment | Approval inserts a receipt; denial finishes; timeout requests one retry. |
| 904 | Retry payment | Approval inserts a receipt; denial finishes. Exhausted timeout is the deliberate defect below. |
| 903 | Dispatch shipment | Approval inserts a shipment and decrements real stock; denial or timeout releases the reservation. |

The faulty policy treats two payment timeouts as authorization and proceeds without inserting a receipt. Choices `[1, -1, -1, 1]` therefore create an actual shipped row without a receipt. The final SQL invariant query returns `1` for that path, and `0` otherwise. The corrected policy stops after the second payment timeout and releases inventory. All paths commit their actual attempt records and final order state. Normal approved paths have three decisions; timeout paths have up to four; early failures have fewer.

The three-choice search has 13 distinct terminal paths in faulty mode and 11 in corrected mode. Those counts are specific to this example and choice set. They do not establish universal correctness of continuation forking or of other programs. Uninterrupted controls instantiate the original raw module and supply the same exact response sequence. Compare all 32 result words, actual SQL JSON rows, return value and complete bridge trace with resumed paths.

`pre_cut` stages 1, 2, 3 and 4 run only before the first decision. `post_cut` records each resumed SQL callback and its nested return; subsequent pauses require no prefix replay. `header_address` and `asyncify_capacity` are pure constant layout accessors. Memory is owned, unshared and fixed at 4 MiB. The closed memory-only VFS supplies deterministic time/randomness, cannot open or delete external files, and adds no WASI imports.

Build with a local free WASI SDK:

```sh
WASI_SDK_PATH=/absolute/path/to/wasi-sdk sh examples/fulfillment/build.sh
```

Keep output basename `workflow.raw.wasm` to reproduce complete bytes, including the module-name custom section. `fixture-layout.json` binds the decoder to the exact raw module hash and fixed memory offsets. SQLite source and archive identity are in `../sqlite/source-manifest.json`; WASI SDK and linked runtime identity are in `../sqlite/sdk-manifest.json`; linked runtime licenses are in `../sqlite/licenses/`. The original workflow/VFS wrapper here is MIT under the repository license. SQLite is public domain. WASI runtime notices and their individual licenses remain applicable to the linked runtime code.
