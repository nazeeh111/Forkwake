#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${WASI_SDK_PATH:?Set WASI_SDK_PATH to an installed WASI SDK directory.}"
sdk=$(CDPATH= cd -- "$WASI_SDK_PATH" && pwd)
cd "$base"
mkdir -p build
node prepare-origin.mjs
output=${FORKWAKE_ORIGIN_BUILD_OUT:-"$base/origin-template.raw.wasm"}
"$sdk/bin/clang" -O1 -mexec-model=reactor -D__EMSCRIPTEN__ -D_GNU_SOURCE '-DCONFIG_VERSION="2026-06-04"' \
 -Ivendor/quickjs-2026-06-04 bridge-origin.c build/origin-quickjs.c vendor/quickjs-2026-06-04/cutils.c \
 vendor/quickjs-2026-06-04/libregexp.c vendor/quickjs-2026-06-04/libunicode.c build/origin-dtoa.c \
 -Wl,--wrap=__wasi_fd_write -Wl,--wrap=__wasi_fd_close -Wl,--wrap=__wasi_fd_seek -Wl,--wrap=__wasi_proc_exit -Wl,--wrap=__wasi_clock_time_get \
 -Wl,--export-memory -Wl,--initial-memory=4194304 -Wl,--max-memory=33554432 -Wl,-z,stack-size=524288 -o "$output"
node --input-type=module - "$output" <<'JS'
import fs from 'node:fs/promises';import {describeTemplate} from '../../lib/script-loader.mjs';
const bytes=await fs.readFile(process.argv[2]),manifest=describeTemplate(bytes),provenance=JSON.parse(await fs.readFile('build/origin-provenance.json','utf8'));
if(!manifest.memoryOrigin)throw Error('Compiled Origin region absent');
await fs.writeFile('origin-template-manifest.json',JSON.stringify({...manifest,originProvenance:provenance},null,2)+'\n');
JS
