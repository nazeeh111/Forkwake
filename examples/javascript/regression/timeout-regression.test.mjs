// Run from a Forkwake checkout. No payment service or network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const root = process.env.FORKWAKE_ROOT
  ? path.resolve(process.env.FORKWAKE_ROOT)
  : fileURLToPath(new URL('../../../', import.meta.url));
const out = process.env.FORKWAKE_RECIPE_OUT;
const policy = process.env.FORKWAKE_RECIPE_POLICY || 'corrected';
assert.ok(out, 'Set FORKWAKE_RECIPE_OUT to a new directory; evidence is retained there');
assert.ok(['faulty', 'corrected'].includes(policy), 'Policy must be faulty or corrected');
const output = path.resolve(out);
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('dispatch requires confirmed payment after two timeouts', {timeout: 420000}, async () => {
  // mkdir is deliberately exclusive. Keep previous failed and successful runs.
  await fs.mkdir(output);
  const commands = [];
  async function cli(args) {
    const record = {args};
    commands.push(record);
    try {
      const run = await exec(process.execPath, [path.join(root, 'cli.mjs'), ...args],
        {cwd: root, timeout: 125000, maxBuffer: 2 * 1024 * 1024});
      Object.assign(record, {code: 0, stdout: run.stdout, stderr: run.stderr});
    } catch (error) {
      Object.assign(record, {code: error.code, stdout: error.stdout, stderr: error.stderr,
        error: error.message});
      throw error;
    } finally {
      await fs.writeFile(path.join(output, 'commands.json'), JSON.stringify(commands, null, 2));
    }
  }
  const source = await fs.readFile(path.join(root, 'examples/javascript/origin-example.js'));
  await fs.writeFile(path.join(output, 'captured-source.js'), source, {flag: 'wx'});
  const capture = path.join(output, 'capture');
  await cli(['capture', '--script', path.join(output, 'captured-source.js'), '--origin',
    '--input', policy === 'faulty' ? '1' : '-1', '--out', capture]);
  const afterTimeouts = path.join(output, 'after-timeouts');
  await cli(['continue', '--workspace', path.join(capture, 'workspace.forkwake'),
    '--responses', '1,-1,-1', '--out', afterTimeouts]);
  let final = (await read(path.join(afterTimeouts, 'outcomes.json'))).final;
  const paused = final.report;
  const callers = paused.origin?.frames || [];
  if (paused.pendingLabel === 'dispatch') {
    // This is the live fourth decision, before supplying the dispatch reply.
    assert.equal(paused.origin.state, 'captured');
    assert.equal(paused.origin.lastDecision, false);
    assert.ok(callers.some(f => f.functionName === 'dispatchOrder' && f.sourceBound));
    assert.ok(callers.some(f => f.functionName === 'checkout' && f.sourceBound));
    const ending = path.join(output, 'ending');
    await cli(['continue', '--workspace', path.join(afterTimeouts, 'workspace.forkwake'),
      '--responses', '1', '--out', ending]);
    final = (await read(path.join(ending, 'outcomes.json'))).final;
  }
  const report = final.report;
  assert.equal(final.status, 'completed', 'The regression needs a completed execution');
  assert.equal(report.origin.sourceSha256, sha(source), 'Report must bind the captured source');
  const ledger = JSON.parse(report.output);
  const receipt = {policy, node: process.version, sourceSha256: sha(source),
    replies: ledger.attempts.map(a => a.reply), callersBeforeDispatch: callers,
    terminalOriginIsLastContext: report.origin.lastDecision,
    resultI32: report.resultI32, ledger,
    invariant: {name: 'dispatch requires confirmed payment',
      passed: !ledger.dispatched || ledger.paid}};
  await fs.writeFile(path.join(output, 'regression-receipt.json'), JSON.stringify(receipt, null, 2));
  assert.deepEqual(receipt.replies, policy === 'faulty' ? [1, -1, -1, 1] : [1, -1, -1],
    'The regression must exercise inventory acceptance and both payment timeouts');
  assert.equal(ledger.reserved, true, 'The order must reach the reserved state');
  assert.equal(ledger.paid, false, 'Both payment attempts must leave payment unconfirmed');
  assert.ok(receipt.invariant.passed,
    `Unpaid dispatch after replies ${receipt.replies.join(',')}; evidence: ${output}`);
});
