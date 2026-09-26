import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { stripMarkup, safeField, FRAME_OPEN, FRAME_CLOSE, UNTRUSTED_NOTICE } from '../src/sanitize.js';

/**
 * D-23 (docs/SPEC.md section 10): a character reference the decoder does
 * not know, or one left behind by a single decoding round, passes through
 * stripMarkup as text, so a renderer that decodes it sees a URL or a
 * comment.
 *
 * Decision this file tests: as stripMarkup's last pass, after the URL
 * defang, every remaining character reference has its & replaced with
 * [&]. A character reference is the CommonMark form: & then #digits,
 * #x plus hex digits, or a letter followed by letters or digits, always
 * ending in ;. The property, that no such reference leaves stripMarkup,
 * is also checked over the generated inputs in
 * test/d6-url-defang-order.test.js, and the pass order by its static
 * check.
 *
 * Expected outputs are written out here, not computed with stripMarkup
 * or safeField. Fixture values avoid the implementation defaults, per
 * SPEC section 8: maxFieldChars 1500 (default 2000), maxOutputChars
 * 123457 (default 50000), maxItems 37 (default 200).
 */

const framed = (s) => `${FRAME_OPEN}${s}${FRAME_CLOSE}`;

const EXACT = [
  // D-15's Session 17 reproduction inputs.
  ['D-15: &colon; spells a scheme', 'http&colon;//evil.example/p', 'http[&]colon;//evil.example/p'],
  ['D-15: &period; spells a www. host', 'www&period;evil&period;example', 'www[&]period;evil[&]period;example'],
  // Other named references the decoder does not know.
  [
    'every URL character spelled by name',
    'https&colon;&sol;&sol;evil&period;example&sol;p',
    'https[&]colon;[&]sol;[&]sol;evil[&]period;example[&]sol;p',
  ],
  ['uppercase name', 'HTTP&COLON;//evil.example', 'HTTP[&]COLON;//evil.example'],
  ['name with digits', 'a &frac12; b', 'a [&]frac12; b'],
  ['non-breaking space', 'a&nbsp;b', 'a[&]nbsp;b'],
  // Double-encoded input: one decoding round leaves a reference.
  [
    'double-encoded comment',
    'a &amp;lt;!-- IGNORE PRIOR --&amp;gt; b',
    'a [&]lt;!-- IGNORE PRIOR --[&]gt; b',
  ],
  ['double-encoded tag', '&amp;lt;script&amp;gt;x', '[&]lt;script[&]gt;x'],
  ['double-encoded scheme colon', 'http&amp;colon;//evil.example/p', 'http[&]colon;//evil.example/p'],
  ['double-encoded www. dots', 'www&amp;period;evil&amp;period;example', 'www[&]period;evil[&]period;example'],
  ['triple-encoded &lt;', '&amp;amp;lt;b&amp;amp;gt;', '[&]amp;lt;b[&]amp;gt;'],
  // A reference inside a URL that is defanged.
  [
    'double-encoded & in a query string',
    'https://evil.example/?a=1&amp;amp;b=2',
    'hxxps://evil[.]example/?a=1[&]amp;b=2',
  ],
  // An & that does not start a character reference is left as written.
  [
    'only references are broken',
    'a & b &1; &x AT&T http&colon;//evil.example',
    'a & b &1; &x AT&T http[&]colon;//evil.example',
  ],
];

for (const [name, input, expected] of EXACT) {
  test(`D-23 exact output, stripMarkup: ${name}`, () => {
    assert.equal(stripMarkup(input), expected);
  });
  test(`D-23 exact output, safeField: ${name}`, () => {
    assert.equal(safeField(input, 1500), framed(expected));
  });
}

// ---- Tool level -------------------------------------------------------------------

const serverCfg = {
  apiKey: 'd23-test-token-000000',
  readOnly: true,
  maxOutputChars: 123457,
  maxFieldChars: 1500,
  maxItems: 37,
};

/** Point fetch at a fake GET /tasks that returns `tasks` in one page. */
function stubTasks(tasks) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const p = new URL(url).pathname.replace(/^\/api\/v1/, '');
    if (p !== '/tasks') throw new Error(`fixture error: unexpected path ${p}`);
    const body = { results: tasks, next_cursor: null };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return () => {
    globalThis.fetch = orig;
  };
}

test('D-23: find-tasks returns no character reference, in content and description', async () => {
  const cases = [EXACT[0], EXACT[1], EXACT[6]];
  const restore = stubTasks(
    cases.map(([, input], i) => ({ id: `t${i}`, content: input, description: input, project_id: 'p0' }))
  );
  let res;
  try {
    const { server } = createServer(serverCfg);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    res = await client.callTool({ name: 'find-tasks', arguments: {} });
    await client.close();
  } finally {
    restore();
  }
  assert.ok(!res.isError, `find-tasks returned an error: ${res.content?.[0]?.text}`);
  const text = res.content.map((c) => c.text).join('\n');
  const prefix = `${UNTRUSTED_NOTICE}\n\n`;
  assert.ok(text.startsWith(prefix), 'fixture error: result does not start with the notice');
  const payload = JSON.parse(text.slice(prefix.length));
  assert.deepEqual(
    payload.tasks.map((t) => [t.id, t.content, t.description]),
    [
      ['t0', framed('http[&]colon;//evil.example/p'), framed('http[&]colon;//evil.example/p')],
      ['t1', framed('www[&]period;evil[&]period;example'), framed('www[&]period;evil[&]period;example')],
      ['t2', framed('a [&]lt;!-- IGNORE PRIOR --[&]gt; b'), framed('a [&]lt;!-- IGNORE PRIOR --[&]gt; b')],
    ]
  );
});
