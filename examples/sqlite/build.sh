#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${WASI_SDK_PATH:?Set WASI_SDK_PATH to an installed WASI SDK directory.}"
compiler="$WASI_SDK_PATH/bin/clang"
[ -x "$compiler" ] || { echo "WASI SDK clang is not executable: $compiler" >&2; exit 1; }
output=${FORKWAKE_BUILD_OUT:-"$base/workflow.raw.wasm"}
"$compiler" -O1 -mexec-model=reactor \
 -DSQLITE_OS_OTHER=1 -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION=1 -DSQLITE_OMIT_WAL=1 \
 -DSQLITE_TEMP_STORE=3 -DSQLITE_DEFAULT_MEMSTATUS=1 -DSQLITE_OMIT_DEPRECATED=1 \
 -I"$base" "$base/workflow.c" "$base/sqlite3.c" \
 -Wl,--export-memory -Wl,--initial-memory=4194304 -Wl,--max-memory=33554432 \
 -Wl,-z,stack-size=131072 -o "$output"
