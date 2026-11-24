import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchaseEmail, welcomeEmail, sendEmail } from '../src/lib/email.js';

test('purchase email carries the consent and how to withdraw', () => {
  const e = purchaseEmail({ planName: 'Starter', priceEur: 9, sessions: 4, startedAt: '2026-11-20T16:00:00Z' });
  assert.match(e.subject, /Starter/);
  for (const s of [e.html, e.text]) {
    assert.match(s, /right away/);
    assert.match(s, /14 days/);
    assert.match(s, /hi@kevi\.online/);
    assert.match(s, /20 November 2026/);
  }
});

test('welcome email names the free minutes and the recording steps', () => {
  const e = welcomeEmail({ trialMinutes: 30 });
  assert.match(e.html, /30 free minutes/);
  assert.match(e.html, /use your speakers/);
});

test('without a key nothing is sent and nothing throws', async () => {
  const saved = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
  assert.equal(await sendEmail({ to: 'a@b.c', subject: 's', html: 'h' }), false);
  if (saved) process.env.RESEND_API_KEY = saved;
});
