import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const report=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
assert.equal(report.search.matched,1);assert.equal(report.search.minimalWithinBounds,true);assert.equal(report.search.witnessCost,2);assert.deepEqual(report.search.witnessResponses,[1,-1,-1,1]);
assert.equal(report.witness.report.kind,'javascript');assert.equal(report.witness.report.status,'completed');assert.equal(report.witness.report.resultI32,1);assert.equal(report.witness.report.entryCount,1);
const ledger=JSON.parse(report.witness.report.output);assert.equal(ledger.balance,75);assert.equal(ledger.recipient,20);assert.equal(ledger.conserved,false);
console.log('Installed JavaScript interpreter reproduced an actual two-change conservation witness.');
