import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setBusy, isBusy, subscribeBusy } from '../src/lib/busyState.js';

test('busy flag notifies only on change', () => {
  let calls = 0;
  const off = subscribeBusy(() => { calls++; });
  setBusy(true); setBusy(true); setBusy(false);
  assert.equal(isBusy(), false);
  assert.equal(calls, 2);
  off();
  setBusy(true);
  assert.equal(calls, 2);
  setBusy(false);
});
