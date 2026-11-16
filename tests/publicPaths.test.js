import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isPublicPath } from '../src/lib/publicPaths.js';

test('sign-in, email links and the legal pages open without an account', () => {
  for (const p of ['/auth', '/auth/confirm', '/privacy', '/terms']) assert.equal(isPublicPath(p), true, p);
});

test('the app itself stays behind sign-in', () => {
  for (const p of ['/', '/sessions', '/ai-chat', '/account', '/privacy/x', '/privacy-old', null, undefined]) {
    assert.equal(isPublicPath(p), false, String(p));
  }
});
