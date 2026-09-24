import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { stripMarkup, safeField, FRAME_OPEN, FRAME_CLOSE, UNTRUSTED_NOTICE } from '../src/sanitize.js';
import {
  shapeTask,
  shapeProject,
  shapeSection,
  shapeLabel,
  shapeComment,
} from '../src/shape.js';

/**
 * D-8 (docs/SPEC.md section 10): one out-of-range numeric entity turns a
 * whole read into an error.
 *
 * Decision this file tests, recorded under R10: a numeric entity whose code
 * point is invalid (above 0x10FFFF, a surrogate 0xD800 to 0xDFFF, or zero)
 * decodes to U+FFFD, as the HTML standard does for invalid numeric
 * character references. Valid numeric entities decode exactly as before.
 *
 * Every call into the sanitizer runs inside assert.doesNotThrow, so a
 * RangeError from the code under test fails on an assertion rather than as
 * an uncaught throw in the test itself.
 *
 * Bug class: any exception raised while shaping one item fails the whole
 * result. Two checks cover it:
 *   - Every shaper is fed hostile strings in every text field it routes
 *     through safeField, and must not throw.
 *   - A static check: String.fromCodePoint, the one call on the shaping
 *     path that throws on a string it was built from, may appear in src/
 *     only inside the guarded helper `decodeCodePoint` in src/sanitize.js.
 * Wrong-typed values (non-string text fields, null items) are D-16's and
 * are not fed here.
 *
 * Fixture values avoid the implementation defaults, per SPEC section 8:
 * maxFieldChars 1500 (default 2000), maxOutputChars 123457 (default
 * 50000), maxItems 37 (default 200).
 */

const __filename = fileURLToPath(import.meta.url);
const SRC_ROOT = path.join(path.dirname(__filename), '..', 'src');

const FFFD = '�';
const MAX_FIELD = 1500;
const shapeCfg = { maxFieldChars: MAX_FIELD };

/** Run stripMarkup, failing on an assertion if it throws. */
function strip(input) {
  let out;
  assert.doesNotThrow(() => {
    out = stripMarkup(input);
  }, `stripMarkup threw for ${JSON.stringify(input)}`);
  return out;
}

// ---- Invalid code points become U+FFFD ---------------------------------------

const INVALID = [
  // D-8's reproduction input, hex and decimal.
  ['hex 0x110000 (reproduction)', 'bad &#x110000; entity', `bad ${FFFD} entity`],
  ['decimal 1114112', 'bad &#1114112; entity', `bad ${FFFD} entity`],
  ['uppercase hex marker', 'a &#X110000; b', `a ${FFFD} b`],
  // Too large for a double to hold exactly: 2^53 + 1.
  ['hex 2^53+1', 'a &#x20000000000001; b', `a ${FFFD} b`],
  ['decimal 2^53+1', 'a &#9007199254740993; b', `a ${FFFD} b`],
  // Too large for a double at all: parses to Infinity.
  ['decimal digit run past Infinity', `a &#${'9'.repeat(400)}; b`, `a ${FFFD} b`],
  ['hex digit run past Infinity', `a &#x${'f'.repeat(300)}; b`, `a ${FFFD} b`],
  // Surrogate range, both ends, both forms.
  ['hex 0xD800', 'a &#xD800; b', `a ${FFFD} b`],
  ['hex 0xDFFF', 'a &#xDFFF; b', `a ${FFFD} b`],
  ['decimal 55296 (0xD800)', 'a &#55296; b', `a ${FFFD} b`],
  ['decimal 57343 (0xDFFF)', 'a &#57343; b', `a ${FFFD} b`],
  // Zero, both forms, and zero-padded.
  ['hex zero', 'a&#x0;b', `a${FFFD}b`],
  ['decimal zero', 'a&#0;b', `a${FFFD}b`],
  ['padded decimal zero', 'a&#0000;b', `a${FFFD}b`],
];

for (const [name, input, expected] of INVALID) {
  test(`D-8: stripMarkup decodes an invalid numeric entity to U+FFFD: ${name}`, () => {
    assert.equal(strip(input), expected);
  });
}

// ---- Valid code points decode exactly as before -------------------------------

const VALID = [
  ['hex 0x10FFFF, the last valid code point', 'a &#x10FFFF; b', 'a \u{10FFFF} b'],
  ['decimal 1114111 (0x10FFFF)', 'a &#1114111; b', 'a \u{10FFFF} b'],
  ['hex 0xD7FF, below the surrogates', 'a &#xD7FF; b', 'a ퟿ b'],
  ['hex 0xE000, above the surrogates', 'a &#xE000; b', 'a  b'],
  ['decimal 65', 'a &#65; b', 'a A b'],
  ['hex 0x1F600', 'a &#x1F600; b', 'a \u{1F600} b'],
];

for (const [name, input, expected] of VALID) {
  test(`D-8: stripMarkup still decodes a valid numeric entity: ${name}`, () => {
    assert.equal(strip(input), expected);
  });
}

test('D-8: safeField frames the reproduction input with U+FFFD instead of throwing', () => {
  let out;
  assert.doesNotThrow(() => {
    out = safeField('bad &#x110000; entity', MAX_FIELD);
  });
  assert.equal(out, `${FRAME_OPEN}bad ${FFFD} entity${FRAME_CLOSE}`);
});

// ---- Bug class: no shaper throws on hostile text ------------------------------

const HOSTILE = [
  '&#x110000;',
  '&#1114112;',
  '&#x20000000000001;',
  '&#9007199254740993;',
  `&#${'9'.repeat(400)};`,
  `&#x${'f'.repeat(300)};`,
  '&#xD800;',
  '&#57343;',
  '&#0;',
  '&#x0;',
  // Raw lone surrogates and mixed junk, to cover the rest of stripMarkup.
  '\uD800 \uDFFF',
  '<a href="https://x.example">&#x110000;</a> [l](https://y.example) &lt;b&gt;',
];

/** Every shaper, with a builder that puts `s` in each text field it frames. */
const SHAPERS = {
  shapeTask: [
    (s) => shapeTask({ id: 't1', content: s }, shapeCfg),
    (s) => shapeTask({ id: 't1', content: 'x', description: s }, shapeCfg),
    (s) => shapeTask({ id: 't1', content: 'x', labels: ['ok', s] }, shapeCfg),
    (s) => shapeTask({ id: 't1', content: 'x', due: { date: '2026-01-01', string: s } }, shapeCfg),
  ],
  shapeProject: [(s) => shapeProject({ id: 'p1', name: s }, shapeCfg)],
  shapeSection: [(s) => shapeSection({ id: 's1', name: s }, shapeCfg)],
  shapeLabel: [(s) => shapeLabel({ id: 'l1', name: s }, shapeCfg)],
  shapeComment: [
    (s) => shapeComment({ id: 'c1', content: s }, shapeCfg),
    (s) => shapeComment({ id: 'c1', content: 'x', attachment: { file_name: s } }, shapeCfg),
  ],
};

test('D-8 class: no shaper throws on hostile text in any framed field', () => {
  const throwing = [];
  for (const [shaper, builders] of Object.entries(SHAPERS)) {
    builders.forEach((build, field) => {
      for (const s of HOSTILE) {
        try {
          build(s);
        } catch (err) {
          throwing.push(`${shaper} field #${field} on ${JSON.stringify(s.slice(0, 40))}: ${err.message}`);
        }
      }
    });
  }
  assert.deepEqual(throwing, [], `shapers threw:\n${throwing.join('\n')}`);
});

// ---- Bug class: static check on String.fromCodePoint -------------------------

const HELPER = 'decodeCodePoint';
const HELPER_FILE = 'sanitize.js';

/**
 * Line numbers of `fromCodePoint(` calls in `source` that are not inside
 * the body of `function decodeCodePoint(`, which runs from its declaration
 * to the next column-0 `}`. Only HELPER_FILE may hold the helper.
 */
function unguardedFromCodePoint(source, allowHelper) {
  const lines = source.split('\n');
  const offenders = [];
  let inHelper = false;
  lines.forEach((line, i) => {
    if (allowHelper && new RegExp(`^(?:export\\s+)?function\\s+${HELPER}\\(`).test(line)) {
      inHelper = true;
    }
    if (/\bfromCodePoint\s*\(/.test(line) && !inHelper) offenders.push(i + 1);
    if (inHelper && /^}/.test(line)) inHelper = false;
  });
  return offenders;
}

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('D-8 class: String.fromCodePoint appears in src/ only inside decodeCodePoint', () => {
  const offenders = [];
  for (const file of listJsFiles(SRC_ROOT)) {
    const rel = path.relative(SRC_ROOT, file);
    const lines = unguardedFromCodePoint(fs.readFileSync(file, 'utf8'), rel === HELPER_FILE);
    for (const line of lines) offenders.push(`src/${rel}:${line}`);
  }
  assert.deepEqual(offenders, [], `unguarded fromCodePoint calls:\n${offenders.join('\n')}`);
});

test('D-8 class: the static check flags a planted unguarded call and passes a guarded one', () => {
  const planted = [
    'function decodeCodePoint(cp) {',
    '  return String.fromCodePoint(cp);',
    '}',
    'function other(x) {',
    '  return String.fromCodePoint(x);',
    '}',
  ].join('\n');
  assert.deepEqual(unguardedFromCodePoint(planted, true), [5]);
  assert.deepEqual(unguardedFromCodePoint(planted, false), [2, 5]);
});

// ---- Tool level: one bad task does not sink the read --------------------------

const serverCfg = {
  apiKey: 'd8-test-token-000000',
  readOnly: true,
  maxOutputChars: 123457,
  maxFieldChars: MAX_FIELD,
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

test('D-8: find-tasks with one bad-entity task still returns every task', async () => {
  const restore = stubTasks([
    { id: 't-fine', content: 'fine task', project_id: 'p0' },
    { id: 't-bad', content: 'bad &#x110000; entity', project_id: 'p0' },
    { id: 't-also-fine', content: 'another fine task', project_id: 'p0' },
  ]);
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
  assert.equal(payload.count, 3);
  assert.deepEqual(
    payload.tasks.map((t) => [t.id, t.content]),
    [
      ['t-fine', `${FRAME_OPEN}fine task${FRAME_CLOSE}`],
      ['t-bad', `${FRAME_OPEN}bad ${FFFD} entity${FRAME_CLOSE}`],
      ['t-also-fine', `${FRAME_OPEN}another fine task${FRAME_CLOSE}`],
    ]
  );
});
