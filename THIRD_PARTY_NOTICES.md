# Third-party notices

SQLite3.54.0 amalgamation is unchanged public-domain SQLite source. Its complete source header and official download identity are retained in examples/sqlite/sqlite3.c and source-manifest.json. The owned workflow, sealed memory-only VFS and fork engine are original MIT code.

Binaryen132 is an Apache-2.0 dependency installed separately through its exact npm lock; upstream: https://github.com/WebAssembly/binaryen. Asyncify is established Binaryen/Emscripten work: https://kripken.github.io/blog/wasm/2019/07/16/asyncify.html. This project claims no invention of execution forking.

The compiled examples use official WASI SDK 34.0. The SQLite WASM contains statically linked wasi-libc, its reactor startup code and compiler-rt runtime code. The SDK and compiler executables are development tools and are not bundled. Exact archive, source commits and runtime-library identities are retained in `examples/sqlite/sdk-manifest.json`.

Full pinned upstream license texts and component notices are included under `examples/sqlite/licenses/`: `WASI-LIBC-LICENSE.txt`, `WASI-LIBC-APACHE-2.0.txt`, `WASI-LIBC-APACHE-2.0-LLVM.txt`, `WASI-LIBC-MIT.txt`, `MUSL-COPYRIGHT.txt`, `CLOUDLIBC-LICENSE.txt`, `MUSL-FTS-COPYING.txt`, `MUSL-FTS-NOTICE.md`, `DLMALLOC-NOTICE.txt`, `EMMALLOC-NOTICE.txt`, `COMPILER-RT-LICENSE.txt` and `WASI-SDK-LICENSE.txt`. These preserve wasi-libc's multi-license notice, musl and bundled component notices, allocator copyright/dedication notices, and compiler-rt's Apache-2.0 with LLVM Exceptions and legacy license texts. Some retained component notices cover library code removed by the linker. No separately billed API or hosted service is required.
