#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${WASI_SDK_PATH:?Set WASI_SDK_PATH to an installed WASI SDK directory.}"
compiler="$WASI_SDK_PATH/bin/clang"
[ -x "$compiler" ] || { echo "WASI SDK clang is not executable: $compiler" >&2; exit 1; }
output=${FORKWAKE_BUILD_OUT:-"$base/fixture.raw.wasm"}
"$compiler" --target=wasm32-unknown-unknown -O1 -fno-inline -nostdlib "$base/fixture.c" \
 -Wl,--no-entry -Wl,--export-memory -Wl,--initial-memory=131072 -Wl,--max-memory=524288 \
 -Wl,-z,stack-size=32768 -o "$output"
