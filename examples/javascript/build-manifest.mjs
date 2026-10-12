import fs from 'node:fs/promises';
import path from 'node:path';
import {describeTemplate} from '../../lib/script-loader.mjs';
const filename=process.argv[2];if(!filename)throw Error('Pass the newly built interpreter filename');
const manifest=describeTemplate(await fs.readFile(filename));
const output=path.join(path.dirname(filename),'template-manifest.json');
await fs.writeFile(output,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({filename,manifest:output,sha256:manifest.templateSha256,moduleBytes:manifest.moduleBytes}));
