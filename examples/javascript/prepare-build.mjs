import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await fs.readFile('source-manifest.json','utf8'));
for(const f of manifest.retainedPristineFiles){const bytes=await fs.readFile(f.path);if(bytes.length!==f.bytes||createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('Pristine upstream file changed: '+f.path);}
const source=await fs.readFile('vendor/quickjs-2026-06-04/dtoa.c','utf8');
if((source.match(/#include <setjmp.h>/g)||[]).length!==1||/\b(?:setjmp|longjmp)\s*\(/.test(source))throw Error('Unused-header compatibility condition no longer holds.');
await fs.writeFile('build/dtoa.c',source.replace('#include <setjmp.h>','#include <stddef.h>'));
