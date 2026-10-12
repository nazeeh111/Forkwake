import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const demo=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
assert.equal(demo.schema,'forkwake.outcomes');
assert.equal(demo.capture.continuationBytes,484);
assert.deepEqual(demo.branches.map(b=>b.report.orders),[3,2,2]);
assert.deepEqual(demo.branches.map(b=>b.report.receiptTotal),[120,0,0]);
assert.deepEqual(demo.branches[1].report.rows.attempts,['denied']);
assert.deepEqual(demo.branches[2].report.rows.attempts,['timeout']);
for(const branch of demo.branches){
  assert.equal(branch.report.autocommitInsideEffect,0);
  assert.equal(branch.report.paymentStatementBusyInsideEffect,1);
  assert.equal(branch.report.sqlCallbackEntries,1);
  assert.equal(branch.summary.checks.prefixNotReexecuted,true);
}
console.log('Installed package executed three actual SQLite futures with one preserved SQL callback.');
