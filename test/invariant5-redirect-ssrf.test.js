/**
 * Invariant 5: "every outbound HTTP request target, including any redirect
 * target, is validated against the SSRF allowlist before the request is
 * sent."
 *
 * Decision (recorded here, not just in docs/SPEC.md): any 3xx response from
 * the Todoist API is treated as an error, full stop. It is never followed,
 * regardless of what host/path the Location header names. A normal API call
 * to api.todoist.com should not redirect; a redirect means something changed
 * that should fail loudly rather than be silently adapted to. This is
 * implemented via `redirect: 'manual'` on the `fetch()` call in
 * `src/client.js`, plus a check that turns any 3xx status into the same
 * `SsrfError` the allowlist check throws, so a redirect and a disallowed host
 * now fail identically, and neither ever contacts a second URL.
 *
 * Why the stub records `opts.redirect`: the fix is specifically that
 * `src/client.js` now passes `redirect: 'manual'` to every `fetch()` call.
 * Without that option, real fetch/undici follows a 3xx internally and the
 * caller never sees it at all (that silent auto-follow is what made the bug
 * possible in the first place). Asserting `opts.redirect === 'manual'`
 * directly on every call is a more precise regression guard than simulating
 * fetch's auto-follow behavior would be: it fails immediately, and
 * specifically, if that option is ever dropped, rather than failing
 * indirectly on "a disallowed host got contacted."
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, SsrfError, API_BASE } from '../src/client.js';

const cfg = { apiKey: 'tok', maxItems: 200, maxFieldChars: 2000, maxOutputChars: 50000 };

/** responses: { [exact url string]: { status, location?, body? } } */
function makeFetchStub(responses) {
  const calls = [];
  return {
    calls,
    fetch: async (url, opts) => {
      calls.push({ url: String(url), opts });
      const r = responses[String(url)];
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: {
          get: (name) => (name.toLowerCase() === 'location' ? r.location ?? null : null),
        },
        text: async () => r.body ?? '',
      };
    },
  };
}

/** Runs a request and always resolves, capturing either the result or the thrown error. */
async function run(responses) {
  const orig = globalThis.fetch;
  const mock = makeFetchStub(responses);
  globalThis.fetch = mock.fetch;
  try {
    const client = createClient(cfg);
    try {
      const result = await client.request('GET', '/tasks');
      return { result, error: undefined, calls: mock.calls };
    } catch (error) {
      return { result: undefined, error, calls: mock.calls };
    }
  } finally {
    globalThis.fetch = orig;
  }
}

const INITIAL = `${API_BASE}/tasks`;

function assertRedirectRefused({ error, calls }, { mustNotAppearInMessage } = {}) {
  assert.ok(
    error instanceof SsrfError,
    `expected an SsrfError, got: ${error ? `${error.name}: ${error.message}` : 'no error (request succeeded)'}`
  );
  assert.equal(calls.length, 1, 'the redirect target must never be contacted');
  assert.equal(calls[0].url, INITIAL);
  assert.equal(calls[0].opts.redirect, 'manual', 'fetch must be called with redirect: "manual"');
  if (mustNotAppearInMessage) {
    assert.doesNotMatch(
      error.message,
      new RegExp(mustNotAppearInMessage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'error message must not echo the Location header value (attacker-influenced content)'
    );
  }
}

// --- Status codes: 301, 302, 307, 308, each redirecting off-host ----------

for (const status of [301, 302, 307, 308]) {
  test(`${status} redirect is refused outright, not followed (Invariant 5)`, async () => {
    const evil = 'https://evil.example/steal';
    const outcome = await run({ [INITIAL]: { status, location: evil } });
    assertRedirectRefused(outcome, { mustNotAppearInMessage: 'evil.example' });
  });
}

// --- Lookalike-host redirect targets, same bypass shapes as client.test.js
//     ("SSRF allowlist accepts only https api.todoist.com"), all refused
//     the same way as any other redirect, since the target is never even
//     inspected. -------------------------------------------------------

test('302 redirect to a subdomain-suffix lookalike host is refused outright (Invariant 5)', async () => {
  const lookalike = 'https://api.todoist.com.evil.example/x';
  const outcome = await run({ [INITIAL]: { status: 302, location: lookalike } });
  assertRedirectRefused(outcome, { mustNotAppearInMessage: 'evil.example' });
});

test('302 redirect to the bare parent domain (missing subdomain) is refused outright (Invariant 5)', async () => {
  const bareDomain = 'https://todoist.com/api/v1/tasks';
  const outcome = await run({ [INITIAL]: { status: 302, location: bareDomain } });
  assertRedirectRefused(outcome);
});

test('302 redirect that downgrades the scheme to http on the correct host is refused outright (Invariant 5)', async () => {
  const httpDowngrade = 'http://api.todoist.com/api/v1/tasks';
  const outcome = await run({ [INITIAL]: { status: 302, location: httpDowngrade } });
  assertRedirectRefused(outcome);
});

// --- Relative-path redirect target on the allowlisted host ----------------

test('302 redirect with a relative Location on the allowlisted host is refused outright too (Invariant 5, relative-path case)', async () => {
  const outcome = await run({
    [INITIAL]: { status: 302, location: '/api/v1/other-endpoint' },
  });

  // Decision recorded: any 3xx is an error, no exceptions for "safe-looking"
  // targets. This case predates that decision. Under the old (partially
  // violated) design, a same-host relative Location was let through, because
  // assertAllowedUrl only checks protocol+hostname and a relative Location
  // can only resolve back onto the same origin, so nothing there could have
  // reached a different host. That reasoning was true, but it's no longer
  // the bar: the decision is that a redirect from the Todoist API is itself
  // the anomaly worth failing loudly on, regardless of where it points.
  // "Looks safe" is not the same as "expected", and normal Todoist API
  // calls do not redirect at all, so this case is refused identically to
  // every other one, and the fact that `/api/v1/other-endpoint` is never
  // even contacted (see the `calls` assertion below) is the point: the
  // client no longer needs to reason about where a redirect leads, because
  // it never looks.
  assertRedirectRefused(outcome);
});

// --- Control: a normal, non-redirect response is unaffected -----------------

test('a normal 200 response still passes redirect: "manual" and is returned normally (control)', async () => {
  const { result, error, calls } = await run({
    [INITIAL]: { status: 200, body: JSON.stringify({ results: [{ id: '1' }], next_cursor: null }) },
  });
  assert.equal(error, undefined);
  assert.deepEqual(result, { results: [{ id: '1' }], next_cursor: null });
  assert.equal(calls[0].opts.redirect, 'manual');
});
