// A tab left open across a deploy keeps running the old JavaScript. That is how
// a 111-minute recording failed to upload: the page was still POSTing audio
// through the API route days after that path had been replaced. The app cannot
// reload by itself — that would cut a recording in half — so it offers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldOfferReload, VERSION_CHECK_MS, DEV_VERSION } from '../src/lib/appVersion.js';

test('a different version than the one this tab loaded is worth offering', () => {
  assert.equal(shouldOfferReload({ loaded: 'abc1234', latest: 'def5678' }), true);
});

test('the same version, or no answer yet, offers nothing', () => {
  assert.equal(shouldOfferReload({ loaded: 'abc1234', latest: 'abc1234' }), false);
  assert.equal(shouldOfferReload({ loaded: 'abc1234', latest: null }), false);
  assert.equal(shouldOfferReload({ loaded: null, latest: 'abc1234' }), false);
  assert.equal(shouldOfferReload({}), false);
  assert.equal(shouldOfferReload(), false);
});

test('local development never nags: there is no deploy to pick up', () => {
  assert.equal(shouldOfferReload({ loaded: DEV_VERSION, latest: 'abc1234' }), false);
  assert.equal(shouldOfferReload({ loaded: 'abc1234', latest: DEV_VERSION }), false);
  assert.equal(DEV_VERSION, 'dev');
});

test('non-strings are ignored rather than read as a new version', () => {
  for (const bad of [0, 1, {}, [], true]) {
    assert.equal(shouldOfferReload({ loaded: 'abc1234', latest: bad }), false, `latest ${JSON.stringify(bad)}`);
    assert.equal(shouldOfferReload({ loaded: bad, latest: 'abc1234' }), false, `loaded ${JSON.stringify(bad)}`);
  }
});

test('the check is often enough to catch a deploy mid-session, rarely enough to be free', () => {
  assert.ok(VERSION_CHECK_MS >= 60 * 1000);
  assert.ok(VERSION_CHECK_MS <= 15 * 60 * 1000);
});
