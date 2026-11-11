import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canCreateAccount, consentMetadata, CONSENT_VERSION, CONSENT_TEXT } from '../src/lib/signupConsent.js';

test('an account cannot be created without the box ticked', () => {
  assert.equal(canCreateAccount({ consent: false }), false);
  assert.equal(canCreateAccount({}), false);
  assert.equal(canCreateAccount(), false);
  assert.equal(canCreateAccount({ consent: 'yes' }), false);
});

test('ticked, it can — unless a request is already in flight', () => {
  assert.equal(canCreateAccount({ consent: true }), true);
  assert.equal(canCreateAccount({ consent: true, loading: true }), false);
});

test('the metadata records what was agreed to and when', () => {
  const m = consentMetadata(new Date('2026-11-11T10:00:00Z'));
  assert.deepEqual(m, {
    consent_version: CONSENT_VERSION,
    consent_at: '2026-11-11T10:00:00.000Z',
    age_confirmed_18: true,
    health_data_consent: true,
  });
});

test('the wording covers age, both documents and health data', () => {
  for (const part of ['18 or older', 'Terms', 'Privacy Policy', 'health-related']) {
    assert.ok(CONSENT_TEXT.includes(part), part);
  }
});
