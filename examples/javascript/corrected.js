// The corrected transfer workflow. No real money or network is used.
// Failed or timed-out confirmation refunds the reserved amount.
var resultI32;
const account = { name: 'Mira', balance: 100 };
account.self = account;
const balances = new Map([[account, account.balance]]);
const ledger = [];
const transfer = (() => {
  let phase = 'new';
  return { set(value) { phase = value; }, get() { return phase; } };
})();

async function settle() {
  const amount = 25;
  if (decision('Reserve funds', { account: account.name, balance: account.balance, amount }) !== 1) {
    emit(JSON.stringify({ phase: 'declined', balance: account.balance, recipient: 20, ledger }));
    resultI32 = 0;
    return;
  }
  account.balance -= amount;
  balances.set(account, account.balance);
  transfer.set('reserved');
  ledger.push({ action: 'reserve', amount });
  await Promise.resolve();
  let confirmation = decision('Confirm transfer', { reference: 'transfer-7', amount, phase: transfer.get() });
  if (confirmation === -1) {
    confirmation = decision('Retry confirmation', { reference: 'transfer-7', amount, balance: account.balance });
  }
  // Only a positive confirmation can settle the transfer.
  let recipient = 20;
  if (confirmation !== 1) {
    account.balance += amount;
    balances.set(account, account.balance);
    transfer.set('refunded');
    ledger.push({ action: 'refund', amount });
  } else {
    if (confirmation === 1) recipient += amount;
    transfer.set('settled');
    ledger.push({ action: 'settle', confirmation });
  }
  await Promise.resolve();
  if (account.self !== account || balances.get(account) !== account.balance) throw Error('Live object identity was lost');
  const conserved = account.balance + recipient === 120;
  decision('Publish receipt', { phase: transfer.get(), balance: account.balance, recipient, conserved });
  emit(JSON.stringify({ phase: transfer.get(), balance: account.balance, recipient, conserved, ledger }, null, 2));
  resultI32 = conserved ? 0 : 1;
}
settle();
