import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAuthLink, hasAuthError } from '../src/lib/authLink.js';

test('a token link from the email templates is verified with its type', () => {
  assert.deepEqual(parseAuthLink('?token_hash=abc&type=recovery'), { kind: 'token', tokenHash: 'abc', type: 'recovery' });
  assert.equal(parseAuthLink('?token_hash=abc&type=signup').type, 'signup');
});

test('a token with an unknown type is refused, not passed to Supabase', () => {
  const out = parseAuthLink('?token_hash=abc&type=admin');
  assert.equal(out.kind, 'error');
  assert.equal(out.expired, false);
});

test('Supabase refusing an old link, in the hash, reads as expired', () => {
  const out = parseAuthLink('', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  assert.equal(out.kind, 'error');
  assert.equal(out.errorCode, 'otp_expired');
  assert.equal(out.expired, true);
});

test('an error in the query string is found too', () => {
  assert.equal(parseAuthLink('?error=access_denied&error_code=otp_expired').kind, 'error');
});

test('an error wins over a token in the same URL', () => {
  assert.equal(parseAuthLink('?token_hash=abc&type=signup&error_code=otp_expired').kind, 'error');
});

test('links sent before the change still work through their code', () => {
  assert.deepEqual(parseAuthLink('?code=xyz'), { kind: 'code', code: 'xyz', type: null });
});

test('a plain URL is not an auth link', () => {
  assert.equal(parseAuthLink('', '').kind, 'none');
  assert.equal(parseAuthLink('?checkout=success').kind, 'none');
  assert.equal(hasAuthError('?checkout=success', ''), false);
  assert.equal(hasAuthError('', '#error_code=otp_expired'), true);
});
