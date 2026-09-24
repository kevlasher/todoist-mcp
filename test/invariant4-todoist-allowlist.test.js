import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { stripMarkup, UNTRUSTED_NOTICE, FRAME_OPEN, FRAME_CLOSE } from '../src/sanitize.js';

/**
 * Decision under test: no todoist.com allowlist exists. stripMarkup defangs
 * every URL-shaped sequence uniformly — break the scheme (http -> hxxp) and
 * every dot (. -> [.]) — regardless of host, so the text stays human-
 * readable but can neither autolink nor be re-parsed. This file was
 * originally written to test a todoist.com exemption; that idea was
 * dropped in favor of uniform defanging, so the cases below now prove the
 * opposite: a todoist.com URL gets defanged exactly like an attacker-
 * controlled one, and the earlier host-matching-trick cases (originally
 * written as allowlist-bypass attempts) still hold as general defanging
 * regression guards.
 *
 * This file writes tests only; src/shape.js is untouched.
 */

function cfg(overrides = {}) {
  return {
    apiKey: 'allowlist-test-token-000000',
    readOnly: true,
    maxOutputChars: 50000,
    maxFieldChars: 2000,
    maxItems: 200,
    ...overrides,
  };
}

async function connect(serverCfg) {
  const { server } = createServer(serverCfg);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

/**
 * Assert a URL was defanged, not exempted and not merely deleted: the
 * original string must not survive verbatim, no live "http(s)://" scheme
 * may survive, the real host's dots must not survive un-bracketed, and a
 * defanged "hxx[p|ps]://" marker must actually be present — proving
 * defanging happened rather than the text vanishing some other way.
 */
function assertDefanged(output, url, label) {
  const host = new URL(url).hostname;

  assert.ok(
    !output.includes(url),
    `${label}: original URL string survived verbatim: ${JSON.stringify(output)}`
  );
  assert.ok(
    !/https?:\/\//i.test(output),
    `${label}: live "http(s)://" scheme survived: ${JSON.stringify(output)}`
  );
  assert.ok(
    !output.includes(host),
    `${label}: live (un-bracketed) host "${host}" survived: ${JSON.stringify(output)}`
  );
  assert.ok(
    /hxxps?:\/\//i.test(output),
    `${label}: expected a defanged "hxx[p|ps]://" marker to be present: ${JSON.stringify(output)}`
  );
}

// ---------------------------------------------------------------------------
// 1. Regression check: a task's `url` field is removed from tool output
//    entirely (D-5). Even when the API response carries a real Todoist task
//    url, neither the url nor a `url` key may survive in find-tasks output.
//    This is separate from defanging, which only touches text run through
//    stripMarkup.
// ---------------------------------------------------------------------------

test('REGRESSION CHECK: no Todoist task url survives in find-tasks output', async () => {
  const TASK_URL = 'https://app.todoist.com/app/task/12345';
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        results: [
          {
            id: '999',
            content: 'Buy milk',
            url: TASK_URL,
          },
        ],
        next_cursor: null,
      }),
  });
  try {
    const client = await connect(cfg({ readOnly: true }));
    const res = await client.callTool({ name: 'find-tasks', arguments: {} });
    const text = res.content.map((c) => c.text).join('\n');
    // An error result also lacks the url, so first require that the tool
    // succeeded and actually returned the fixture task (D-12).
    assert.ok(!res.isError, `find-tasks returned an error: ${text}`);
    const prefix = `${UNTRUSTED_NOTICE}\n\n`;
    assert.ok(text.startsWith(prefix), `result does not start with the notice: ${text}`);
    const payload = JSON.parse(text.slice(prefix.length));
    const task = payload.tasks?.find((t) => t.id === '999');
    assert.ok(task, `fixture task 999 not returned: ${text}`);
    assert.equal(task.content, `${FRAME_OPEN}Buy milk${FRAME_CLOSE}`);
    assert.equal(Object.hasOwn(task, 'url'), false, `url key present: ${JSON.stringify(task.url)}`);
    assert.ok(
      !text.includes(TASK_URL) && !text.includes('"url"'),
      `expected task url field to be absent from output (D-5); got: ${text}`
    );
    await client.close();
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// 2. Defanging regression guards: each of these must be DEFANGED, not
//    exempted and not silently deleted some other way. Several are
//    host-matching tricks (userinfo, path, query-string, case, embedded
//    subdomain) that would fool a naive substring check for "todoist.com" —
//    they matter less as allowlist bypasses now (there's no allowlist) and
//    more as proof that defanging itself doesn't depend on host parsing at
//    all: it applies uniformly, so none of these tricks change the outcome.
// ---------------------------------------------------------------------------

const defangCases = [
  {
    name: 'todoist.com as a prefix of an attacker-controlled hostname',
    url: 'https://todoist.com.exfil-domain.com/steal',
  },
  {
    name: 'unrelated host that merely contains the substring "todoist"',
    url: 'https://nottodoist.com/steal',
  },
  {
    name: 'todoist.com only appears in a query string, not the actual host',
    url: 'https://evil.example/?next=https://todoist.com',
  },
  {
    name: 'todoist.com used as userinfo, actual host is evil.example',
    url: 'https://todoist.com@evil.example/steal',
  },
  {
    name: 'todoist.com only appears in the path, not the host',
    url: 'https://evil.example/todoist.com/steal',
  },
  {
    name: 'uppercase host trick — attacker-controlled hostname',
    url: 'https://TODOIST.COM.evil.example/steal',
  },
  {
    name: 'http (not https) scheme, attacker-controlled hostname',
    url: 'http://todoist.com.evil.example/steal',
  },
  {
    name: 'todoist.com embedded mid-hostname of an unrelated domain',
    url: 'https://sub.todoist.com.evil.example/steal',
  },
  // No-exemption proof: a genuine todoist.com URL is defanged exactly like
  // any other host — there is no allowlist anywhere in stripMarkup.
  {
    name: 'NO-EXEMPTION PROOF: genuine todoist.com apex domain, showTask link',
    url: 'https://todoist.com/showTask?id=123',
  },
  {
    name: 'NO-EXEMPTION PROOF: genuine app.todoist.com subdomain, task deep link',
    url: 'https://app.todoist.com/app/task/12345',
  },
];

for (const { name, url } of defangCases) {
  test(`stripMarkup defangs uniformly — ${name}`, () => {
    const out = stripMarkup(`Click here: ${url} now`);
    assertDefanged(out, url, name);
  });
}
