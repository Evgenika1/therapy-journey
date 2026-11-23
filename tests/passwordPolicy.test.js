import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordProblem, MIN_PASSWORD_LENGTH } from '../src/lib/passwordPolicy.js';

test('new passwords need at least 10 characters', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 10);
  assert.match(passwordProblem('short'), /at least 10/);
  assert.equal(passwordProblem('long enough!'), null);
  assert.match(passwordProblem(''), /enter a password/);
});
