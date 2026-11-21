import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refundQuote } from '../src/lib/refundPolicy.js';

const paidAt = '2026-11-20T16:00:00Z';
const at = d => new Date(`2026-11-${d}T12:00:00Z`);

test('within 14 days the unused share comes back', () => {
  const q = refundQuote({ paidCents: 900, planMinutes: 400, usedMinutes: 100, paidAt, now: at(25) });
  assert.equal(q.withinWithdrawal, true);
  assert.equal(q.amountCents, 675);
});

test('nothing used gives everything back', () => {
  assert.equal(refundQuote({ paidCents: 900, planMinutes: 400, usedMinutes: 0, paidAt, now: at(21) }).amountCents, 900);
});

test('more than the plan used gives nothing back', () => {
  assert.equal(refundQuote({ paidCents: 900, planMinutes: 400, usedMinutes: 450, paidAt, now: at(21) }).amountCents, 0);
});

test('after 14 days there is no refund', () => {
  const q = refundQuote({ paidCents: 900, planMinutes: 400, usedMinutes: 0, paidAt, now: new Date('2026-12-05T12:00:00Z') });
  assert.equal(q.withinWithdrawal, false);
  assert.equal(q.amountCents, 0);
});

test('day 14 still counts', () => {
  assert.equal(refundQuote({ paidCents: 900, planMinutes: 400, usedMinutes: 0, paidAt, now: new Date('2026-12-04T17:00:00Z') }).withinWithdrawal, true);
});

test('our fault refunds everything, even late', () => {
  const q = refundQuote({ paidCents: 900, planMinutes: 400, usedMinutes: 300, paidAt, now: new Date('2027-01-01'), ourFault: true });
  assert.equal(q.amountCents, 900);
});

test('rounds down to a whole cent', () => {
  assert.equal(refundQuote({ paidCents: 900, planMinutes: 400, usedMinutes: 1.3, paidAt, now: at(21) }).amountCents, 897);
});

test('what was already refunded is taken off', () => {
  assert.equal(refundQuote({ paidCents: 900, refundedCents: 900, planMinutes: 400, usedMinutes: 0, paidAt, now: at(21) }).amountCents, 0);
  assert.equal(refundQuote({ paidCents: 900, refundedCents: 200, planMinutes: 400, usedMinutes: 100, paidAt, now: at(21) }).amountCents, 475);
});
