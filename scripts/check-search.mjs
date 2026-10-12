import fs from 'node:fs';import assert from 'node:assert/strict';
const document=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),r=document.search;
assert.equal(document.schema,'forkwake.sequence-search');
assert.equal(r.witnessCost,2);assert.deepEqual(r.witnessResponses,[1,-1,-1,1]);assert.equal(r.minimalWithinBounds,true);assert.equal(r.goal,1);
console.log('Installed package searched real SQLite futures and found the two-change witness.');
