// Every row written before migration 023 has no kind, and every one of them was
// a therapy session. That default is the whole safety of this feature, so it is
// pinned here rather than repeated at call sites.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_KINDS, DEFAULT_KIND, KIND_LABELS, normalizeKind, kindOf, readLastKind, rememberKind,
} from '../src/lib/sessionKind.js';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('there are exactly two kinds, therapy first', () => {
  assert.deepEqual(SESSION_KINDS, ['therapy', 'coaching']);
  assert.equal(DEFAULT_KIND, 'therapy');
  assert.deepEqual(KIND_LABELS, { therapy: 'Therapy', coaching: 'Coaching' });
});

test('anything that is not a known kind is therapy', () => {
  assert.equal(normalizeKind('coaching'), 'coaching');
  assert.equal(normalizeKind('therapy'), 'therapy');
  for (const v of [undefined, null, '', 'Coaching', 'mentoring', 42, {}]) {
    assert.equal(normalizeKind(v), 'therapy', `${JSON.stringify(v)} should be therapy`);
  }
});

test('a row without a kind column is a therapy session', () => {
  assert.equal(kindOf({ id: 's1' }), 'therapy');
  assert.equal(kindOf({ kind: 'coaching' }), 'coaching');
  assert.equal(kindOf(null), 'therapy');
});

test('the last chosen kind is remembered and read back', () => {
  const storage = memoryStorage();
  assert.equal(readLastKind(storage), 'therapy');
  assert.equal(rememberKind('coaching', storage), 'coaching');
  assert.equal(readLastKind(storage), 'coaching');
});

test('storage that throws or holds junk never breaks recording', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readLastKind(broken), 'therapy');
  assert.equal(rememberKind('coaching', broken), 'coaching');
  const junk = memoryStorage(); junk.setItem('miru.sessionKind', 'nonsense');
  assert.equal(readLastKind(junk), 'therapy');
  assert.equal(readLastKind(undefined), 'therapy');
});
