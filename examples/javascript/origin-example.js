// An intentionally faulty closed checkout. Seed < 0 selects the corrected rule.
// Replies are local controlled integers, not actual vendor/API requests.
const order = {id: 'parcel-17', quantity: 4, total: 120};
const ledger = {reserved: false, paid: false, dispatched: false, attempts: []};

function callVendor(label, details) {
  const reply = decision(label, details);
  ledger.attempts.push({label, reply});
  return reply;
}

function paymentAttempt(order) {
  const reply = callVendor('payment', {id: order.id, total: order.total});
  if (reply === 1) ledger.paid = true;
  return reply;
}

function dispatchOrder(order) {
  const reply = callVendor('dispatch', {id: order.id, paid: ledger.paid});
  ledger.dispatched = reply === 1;
}

async function checkout(order) {
  ledger.reserved = callVendor('inventory', {quantity: order.quantity}) === 1;
  if (!ledger.reserved) return 0;
  let paidReply = paymentAttempt(order);
  if (paidReply === -1) {
    // The resumed caller stack after await has no old Promise scheduling frame.
    await Promise.resolve();
    paidReply = paymentAttempt(order);
  }
  // Fault: two timeouts permit dispatch even though payment is unconfirmed.
  if (ledger.paid || (seed > 0 && paidReply === -1)) dispatchOrder(order);
  return ledger.dispatched && !ledger.paid ? 1 : 0;
}

Promise.resolve().then(() => checkout(order)).then(result => {
  globalThis.resultI32 = result;
  emit(JSON.stringify(ledger));
});
