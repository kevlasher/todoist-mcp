import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAllowedUrl,
  createClient,
  SsrfError,
  API_BASE,
  TodoistApiError,
} from '../src/client.js';
import { registerSecret } from '../src/redact.js';

test('SSRF allowlist accepts only https api.todoist.com', () => {
  assert.ok(assertAllowedUrl('https://api.todoist.com/api/v1/tasks'));
  assert.throws(() => assertAllowedUrl('http://api.todoist.com/api/v1/tasks'), SsrfError);
  assert.throws(() => assertAllowedUrl('https://evil.example/api/v1/tasks'), SsrfError);
  assert.throws(() => assertAllowedUrl('https://api.todoist.com.evil.example/x'), SsrfError);
  assert.throws(() => assertAllowedUrl('https://todoist.com/api/v1/tasks'), SsrfError);
  assert.throws(() => assertAllowedUrl('file:///etc/passwd'), SsrfError);
  assert.throws(() => assertAllowedUrl('not a url'), SsrfError);
});

test('assertAllowedUrl blocks host override attempts in the base path', () => {
  // Even if a path tries to smuggle a host, URL parsing keeps host pinned.
  assert.ok(assertAllowedUrl(API_BASE + '/tasks'));
});

function mockFetch(pages) {
  let call = 0;
  return async () => {
    const page = pages[call++] ?? { results: [], next_cursor: null };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(page),
    };
  };
}

const cfg = { apiKey: 'tok', maxItems: 200, maxFieldChars: 2000, maxOutputChars: 50000 };

test('getPaginated follows next_cursor until exhausted', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch([
    { results: [{ id: '1' }, { id: '2' }], next_cursor: 'c1' },
    { results: [{ id: '3' }], next_cursor: null },
  ]);
  try {
    const client = createClient(cfg);
    const { items, truncated } = await client.getPaginated('/tasks', {});
    assert.equal(items.length, 3);
    assert.equal(truncated, false);
  } finally {
    globalThis.fetch = orig;
  }
});

test('getPaginated respects the item cap', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch([
    { results: [{ id: '1' }, { id: '2' }, { id: '3' }], next_cursor: 'c1' },
    { results: [{ id: '4' }, { id: '5' }], next_cursor: 'c2' },
  ]);
  try {
    const client = createClient(cfg);
    const { items } = await client.getPaginated('/tasks', {}, 4);
    assert.equal(items.length, 4);
  } finally {
    globalThis.fetch = orig;
  }
});

test('API error text never leaks the token', async () => {
  // A token long enough to be registered (R6). The three-character `tok`
  // used by `cfg` is never registered, which is D-17, not this test.
  // createClient does not register its own token (also D-17), so the test
  // registers it the way createServer does. The value is made up: shaped
  // like a Todoist token, never sent anywhere. `.gitleaks.toml` allowlists
  // this exact value.
  const token = '0123456789abcdef0123456789abcdef01234567';
  registerSecret(token);
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => `Unauthorized: token ${token} is invalid`,
  });
  try {
    const client = createClient({ ...cfg, apiKey: token });
    await assert.rejects(
      () => client.request('GET', '/tasks'),
      (err) => {
        assert.ok(err instanceof TodoistApiError, `expected a TodoistApiError, got ${err}`);
        assert.equal(err.status, 401);
        assert.ok(
          !err.message.includes(token),
          `token leaked into the error message: ${err.message}`
        );
        assert.ok(
          err.message.includes('Unauthorized: token [REDACTED] is invalid'),
          `expected the API detail in the message with the token redacted; got: ${err.message}`
        );
        return true;
      }
    );
  } finally {
    globalThis.fetch = orig;
  }
});
