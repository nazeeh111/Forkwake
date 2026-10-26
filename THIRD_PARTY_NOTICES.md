# Third-party notices

SQLite3.54.0 amalgamation is unchanged public-domain SQLite source. Its complete source header and official download identity are retained in examples/sqlite/sqlite3.c and source-manifest.json. The owned workflow, sealed memory-only VFS and fork engine are original MIT code.

Binaryen132 is an Apache-2.0 dependency installed separately through its exact npm lock; upstream: https://github.com/WebAssembly/binaryen.

The compiled examples use official WASI SDK 34.0. The SQLite WASM contains statically linked wasi-libc, its reactor startup code and compiler-rt runtime code. The SDK and compiler executables are development tools and are not bundled. Exact archive, source commits and runtime-library identities are retained in `examples/sqlite/sdk-manifest.json`.

Full pinned upstream license texts and component notices are included under `examples/sqlite/licenses/`: `WASI-LIBC-LICENSE.txt`, `WASI-LIBC-APACHE-2.0.txt`, `WASI-LIBC-APACHE-2.0-LLVM.txt`, `WASI-LIBC-MIT.txt`, `MUSL-COPYRIGHT.txt`, `CLOUDLIBC-LICENSE.txt`, `MUSL-FTS-COPYING.txt`, `MUSL-FTS-NOTICE.md`, `DLMALLOC-NOTICE.txt`, `EMMALLOC-NOTICE.txt`, `COMPILER-RT-LICENSE.txt` and `WASI-SDK-LICENSE.txt`. These preserve wasi-libc's multi-license notice, musl and bundled component notices, allocator copyright/dedication notices, and compiler-rt's Apache-2.0 with LLVM Exceptions and legacy license texts. Some retained component notices cover library code removed by the linker.

The JavaScript guest embeds unchanged MIT-licensed QuickJS2026-06-04 source files under `examples/javascript/vendor/quickjs-2026-06-04/`, with the full upstream LICENSE and each original source notice retained. Its downloaded archive identity and per-file SHA256 values are in `examples/javascript/source-manifest.json`. The build generates a separate dtoa.c copy with one unused header compatibility change; pristine upstream bytes remain unchanged. Its statically linked WASI SDK34 runtime uses the same full source/runtime provenance and license texts retained above. The prebuilt interpreter needs no compiler at use time.

The optional Origin interpreter builds a separate QuickJS compatibility copy
that escapes guest-controlled function names when formatting backtraces. Exact
patch text, pristine and generated source hashes, original bridge identity and
trace layout are retained in `examples/javascript/origin-template-manifest.json`.
`prepare-origin.mjs` generates the copies; upstream notices and full MIT license
remain intact. The original interpreter and pristine vendor bytes are unchanged.
