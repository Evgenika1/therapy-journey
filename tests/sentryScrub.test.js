import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubEvent, scrubBreadcrumb } from '../src/lib/sentryScrub.js';

test('drops request body, cookies, headers and query; keeps the path', () => {
  const event = scrubEvent({
    request: {
      url: 'https://www.kevi.online/api/analyze?token=abc',
      data: { transcript: 'I told my therapist…' },
      cookies: { sb: 'x' },
      headers: { authorization: 'Bearer x' },
      query_string: 'token=abc',
    },
  });
  assert.deepEqual(event.request, { url: 'https://www.kevi.online/api/analyze' });
});

test('drops user, extra and server name', () => {
  const event = scrubEvent({
    user: { email: 'a@b.com', ip_address: '1.2.3.4' },
    extra: { body: 'secret' },
    server_name: 'host',
  });
  assert.equal(event.user, undefined);
  assert.equal(event.extra, undefined);
  assert.equal(event.server_name, undefined);
});

test('masks email addresses in messages and exception values', () => {
  const event = scrubEvent({
    message: 'no account for jane.doe+x@gmail.com',
    exception: { values: [{ type: 'Error', value: 'user a@b.co failed' }] },
  });
  assert.equal(event.message, 'no account for [email]');
  assert.equal(event.exception.values[0].value, 'user [email] failed');
});

test('cuts long exception values so quoted text cannot leak whole', () => {
  const long = 'x'.repeat(1000);
  const event = scrubEvent({ exception: { values: [{ value: long }] } });
  assert.ok(event.exception.values[0].value.length <= 301);
});

test('scrubs breadcrumbs inside the event', () => {
  const event = scrubEvent({
    breadcrumbs: [
      { category: 'console', message: 'transcript: hello' },
      { category: 'fetch', data: { url: '/api/chat?q=hi', method: 'POST' } },
    ],
  });
  assert.equal(event.breadcrumbs.length, 1);
  assert.equal(event.breadcrumbs[0].data.url, '/api/chat');
});

test('console breadcrumbs are dropped, ui clicks lose their text', () => {
  assert.equal(scrubBreadcrumb({ category: 'console', message: 'anything' }), null);
  const click = scrubBreadcrumb({ category: 'ui.click', message: 'button "Delete my diary"' });
  assert.equal(click.message, undefined);
});

test('navigation breadcrumbs lose query strings', () => {
  const crumb = scrubBreadcrumb({
    category: 'navigation',
    data: { from: '/sessions?id=1', to: '/auth/confirm?token_hash=abc' },
  });
  assert.deepEqual(crumb.data, { from: '/sessions', to: '/auth/confirm' });
});
