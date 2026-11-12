// Plans, prices and where an account's minutes come from. The gate that
// spends money reads resolveAllowance, so its order of precedence is pinned.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLANS, PLAN_ORDER, MINUTES_PER_SESSION, priceIdFor, planForPriceId, subscriptionGrants,
  subscriptionRow, shouldReplace, resolveAllowance, allowanceStatus, sessionsFromMinutes, blockedMessage,
} from '../src/lib/plans.js';
import { MONTHLY_MINUTES } from '../src/lib/usageQuota.js';

const env = { STRIPE_PRICE_STARTER: 'price_s', STRIPE_PRICE_PRO: 'price_p', STRIPE_PRICE_INTENSIVE: 'price_i' };
const NOW = new Date('2026-11-12T10:00:00Z');

test('each plan is sold as sessions and metered at 100 minutes a session', () => {
  assert.deepEqual(PLAN_ORDER.map(p => [PLANS[p].priceEur, PLANS[p].sessions, PLANS[p].minutes]),
    [[9, 4, 400], [19, 12, 1200], [29, 25, 2500]]);
  for (const p of PLAN_ORDER) assert.equal(PLANS[p].minutes, PLANS[p].sessions * MINUTES_PER_SESSION);
  assert.equal(sessionsFromMinutes(250), 2.5);
  assert.equal(sessionsFromMinutes(-5), 0);
});

test('the server maps a plan to its price and back; anything else is refused', () => {
  assert.equal(priceIdFor('pro', env), 'price_p');
  for (const bad of ['enterprise', '', null, undefined, 'price_p', '__proto__', 'toString']) {
    assert.equal(priceIdFor(bad, env), null, String(bad));
  }
  assert.equal(priceIdFor('pro', {}), null, 'an unset price is not an empty string');
  assert.equal(planForPriceId('price_i', env), 'intensive');
  assert.equal(planForPriceId('price_other', env), null);
  assert.equal(planForPriceId(undefined, {}), null);
});

test('active, trialing and past_due keep the minutes; anything final does not', () => {
  for (const status of ['active', 'trialing', 'past_due']) assert.equal(subscriptionGrants({ status, plan: 'pro' }), true, status);
  for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
    assert.equal(subscriptionGrants({ status, plan: 'pro' }), false, status);
  }
  assert.equal(subscriptionGrants({ status: 'active', plan: null }), false, 'an unknown price grants nothing');
  assert.equal(subscriptionGrants(null), false);
});

test('a Stripe subscription becomes a row, with the period read from the item (2025+ API)', () => {
  const sub = {
    id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, cancel_at: null,
    items: { data: [{ price: { id: 'price_p' }, current_period_start: 1762941600, current_period_end: 1765533600 }] },
  };
  const row = subscriptionRow(sub, 'user-1', env);
  assert.equal(row.user_id, 'user-1');
  assert.equal(row.stripe_customer_id, 'cus_1');
  assert.equal(row.stripe_subscription_id, 'sub_1');
  assert.equal(row.plan, 'pro');
  assert.equal(row.status, 'active');
  assert.equal(row.cancel_at_period_end, false);
  assert.equal(row.current_period_start, new Date(1762941600 * 1000).toISOString());
  assert.equal(row.current_period_end, new Date(1765533600 * 1000).toISOString());
});

test('the older API shape, an expanded customer and a scheduled cancel are read too', () => {
  const row = subscriptionRow({
    id: 'sub_2', customer: { id: 'cus_2' }, status: 'active', cancel_at_period_end: false, cancel_at: 1765533600,
    current_period_start: 1762941600, current_period_end: 1765533600,
    items: { data: [{ price: { id: 'price_s' } }] },
  }, 'u', env);
  assert.equal(row.stripe_customer_id, 'cus_2');
  assert.equal(row.plan, 'starter');
  assert.equal(row.cancel_at_period_end, true);
  assert.equal(row.current_period_start, new Date(1762941600 * 1000).toISOString());
});

test('an old cancelled subscription cannot overwrite a newer active one', () => {
  const active = { stripe_subscription_id: 'sub_new', status: 'active', plan: 'pro' };
  assert.equal(shouldReplace(active, { stripe_subscription_id: 'sub_old', status: 'canceled', plan: 'pro' }), false);
  assert.equal(shouldReplace(active, { stripe_subscription_id: 'sub_new', status: 'canceled', plan: 'pro' }), true, 'its own cancellation goes through');
  assert.equal(shouldReplace(active, { stripe_subscription_id: 'sub_newer', status: 'active', plan: 'intensive' }), true);
  assert.equal(shouldReplace(null, { stripe_subscription_id: 'sub_1', status: 'incomplete' }), true);
  assert.equal(shouldReplace({ stripe_customer_id: 'cus', stripe_subscription_id: null }, { stripe_subscription_id: 'sub_1' }), true);
});

test('an admin override beats the plan, the plan beats nothing, and nothing is zero', () => {
  const sub = { plan: 'pro', status: 'active', current_period_start: '2026-11-05T09:00:00.000Z', current_period_end: '2026-12-05T09:00:00.000Z' };
  const o = resolveAllowance({ quotaRow: { monthly_minutes: 7000 }, subscription: sub, now: NOW });
  assert.deepEqual([o.minutes, o.source, o.periodStart], [7000, 'override', '2026-11-05T09:00:00.000Z']);
  const p = resolveAllowance({ subscription: sub, now: NOW });
  assert.deepEqual([p.minutes, p.source, p.plan, p.periodEnd], [1200, 'plan', 'pro', '2026-12-05T09:00:00.000Z']);
  const n = resolveAllowance({ now: NOW });
  assert.deepEqual([n.minutes, n.source, n.periodStart], [0, 'none', '2026-11-01T00:00:00.000Z']);
});

test('an override without a plan runs over the calendar month', () => {
  const a = resolveAllowance({ quotaRow: { monthly_minutes: 400 }, now: NOW });
  assert.deepEqual([a.minutes, a.source, a.periodStart], [400, 'override', '2026-11-01T00:00:00.000Z']);
});

test('an unusable override is ignored, not treated as zero', () => {
  const a = resolveAllowance({ quotaRow: { monthly_minutes: -3 }, subscription: { plan: 'starter', status: 'active' }, now: NOW });
  assert.equal(a.source, 'plan');
  assert.equal(a.minutes, 400);
});

test('a failed read falls back to the old default instead of zero', () => {
  const a = resolveAllowance({ readFailed: true, now: NOW });
  assert.deepEqual([a.minutes, a.source], [MONTHLY_MINUTES, 'fallback']);
});

test('no plan blocks outright; a plan blocks only past the overdraft', () => {
  const none = allowanceStatus({ minutes: 0, source: 'none' }, 0);
  assert.deepEqual([none.status, none.reason], ['blocked', 'no_plan']);
  assert.equal(allowanceStatus({ minutes: 400, source: 'plan' }, 100).status, 'ok');
  assert.equal(allowanceStatus({ minutes: 400, source: 'plan' }, 405).status, 'warn', 'inside the overdraft');
  const over = allowanceStatus({ minutes: 400, source: 'plan' }, 500);
  assert.deepEqual([over.status, over.reason], ['blocked', 'limit']);
});

test('the blocked message names the way out', () => {
  assert.match(blockedMessage('no_plan'), /Billing/);
  assert.match(blockedMessage('limit'), /used all sessions/);
});
