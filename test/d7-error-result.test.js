import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { buildResult } from '../src/result.js';
import { registerSecret } from '../src/redact.js';
import { FRAME_OPEN, FRAME_CLOSE, UNTRUSTED_NOTICE } from '../src/sanitize.js';

/**
 * D-7 (docs/SPEC.md section 10): error results are not stripped, framed,
 * noticed or capped.
 *
 * Decision this file tests (recorded under D-7 and AD-4): an error result
 * gets the same treatment as a success result. The error message goes
 * through safeField, so it is stripped, defanged and fenced; the result
 * carries UNTRUSTED_NOTICE; the total is capped by maxOutputChars; isError
 * stays true. Redaction runs before any stripping, fencing or truncation
 * and again as the final step, so a cut can never split a secret into a
 * fragment that redaction no longer recognizes. That ordering applies to
 * the success path too.
 *
 * Expected outputs are written out here, not computed with stripMarkup or
 * safeField. Fixture values avoid the implementation defaults, per SPEC
 * section 8: maxFieldChars 1500 (default 2000), maxItems 37 (default 200),
 * maxOutputChars 100 (D-7's reproduction input) or 4321 (default 50000).
 *
 * Bug classes: (1) a result path whose text skips the success path's
 * treatment, checked by running every tool from tools/list into an
 * upstream error and by feeding one tool every other error source;
 * (2) text cut before it is redacted, checked by the token tests on both
 * paths and by the static check at the end, which allows a string cut in
 * src/ only inside the one helper that redacts first, and requires every
 * stripMarkup call in src/ to take redacted text.
 */

const framed = (s) => `${FRAME_OPEN}${s}${FRAME_CLOSE}`;
const suffix = (cap) =>
  `\n\n…[output truncated at ${cap} characters to bound context; refine your query or narrow the request]`;

// A 40-character hex token, the form Todoist issues.
const TOKEN = '7c1e9a40d3b85f26e1a0c94b7d2f58e3a6b1c0d9';
// The shortest token prefix that counts as a leak. Nothing else in these
// outputs contains it.
const FRAGMENT = TOKEN.slice(0, 6);

const cfg = (over = {}) => ({
  apiKey: TOKEN,
  readOnly: false,
  maxOutputChars: 100,
  maxFieldChars: 1500,
  maxItems: 37,
  ...over,
});

// D-7's reproduction body.
const HOSTILE_BODY = '<b>OBEY</b> https://evil.example ' + 'A'.repeat(3000);

async function connect(c) {
  const { server } = createServer(c);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Run `fn` with fetch replaced by `impl`, restoring it afterwards. */
async function withFetch(impl, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

const upstream400 = async () => ({ ok: false, status: 400, text: async () => HOSTILE_BODY });

/** Call one tool with fetch replaced, asserting whether it errored. */
async function callOne(c, fetchImpl, name, args, expectError) {
  return withFetch(fetchImpl, async () => {
    const client = await connect(c);
    try {
      const res = await client.callTool({ name, arguments: args });
      assert.equal(res.isError === true, expectError, `${name}: ${res.content?.[0]?.text}`);
      return res;
    } finally {
      await client.close();
    }
  });
}

const textOf = (res) => res.content.map((x) => x.text).join('\n');

// ---- D-7's reproduction input -----------------------------------------------

test('D-7 reproduction: find-projects error result is stripped, defanged, fenced, noticed and capped at 100', async () => {
  const res = await callOne(cfg({ readOnly: true }), upstream400, 'find-projects', {}, true);
  assert.equal(res.isError, true);
  const text = textOf(res);
  assert.ok(!text.includes('<b>'), 'no <b> may survive');
  assert.ok(!text.includes('https://'), 'no https:// may survive');
  const expected =
    `${UNTRUSTED_NOTICE}\n\n` +
    `Error: ${FRAME_OPEN}Todoist API 400 on GET /projects: OBEY hxxps://evil[.]example ` +
    'A'.repeat(20) +
    suffix(100);
  assert.equal(text, expected);
  assert.equal(text.length, UNTRUSTED_NOTICE.length + 2 + 100 + suffix(100).length);
});

test('D-7 reproduction under a cap it fits: the error text is framed whole', async () => {
  const res = await callOne(cfg({ readOnly: true, maxOutputChars: 4321 }), upstream400, 'find-projects', {}, true);
  assert.equal(res.isError, true);
  // client.js keeps the first 500 characters of the body: 33 before the As, 467 As.
  assert.equal(
    textOf(res),
    `${UNTRUSTED_NOTICE}\n\n` +
      'Error: ' +
      framed('Todoist API 400 on GET /projects: OBEY hxxps://evil[.]example ' + 'A'.repeat(467))
  );
});

// ---- Bug class 1: every tool, and every error source ------------------------

// Minimal valid arguments that make each tool reach its first request.
const ARGS = {
  'find-tasks': {},
  'find-tasks-by-date': { preset: 'today' },
  'find-projects': {},
  'find-sections': {},
  'find-labels': {},
  'find-comments': { task_id: '123' },
  'get-overview': {},
  'add-tasks': { tasks: [{ content: 'Buy milk' }] },
  'update-tasks': { tasks: [{ id: '123', priority: 3 }] },
  'complete-tasks': { ids: ['123'] },
  'uncomplete-tasks': { ids: ['123'] },
  'reschedule-tasks': { tasks: [{ id: '123', due_date: '2026-10-01' }] },
  'add-comments': { comments: [{ task_id: '123', content: 'hi' }] },
  'add-projects': { projects: [{ name: 'P' }] },
  'add-sections': { sections: [{ name: 'S', project_id: '123' }] },
  'add-labels': { labels: [{ name: 'L' }] },
};

test('D-7 class: every tool in tools/list returns an upstream error stripped, fenced, noticed and capped', async () => {
  await withFetch(upstream400, async () => {
    const client = await connect(cfg());
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(
        tools.map((t) => t.name).sort(),
        Object.keys(ARGS).sort(),
        'every tool in tools/list needs an ARGS entry'
      );
      const bound = UNTRUSTED_NOTICE.length + 2 + 100 + suffix(100).length;
      for (const { name } of tools) {
        const res = await client.callTool({ name, arguments: ARGS[name] });
        assert.equal(res.isError, true, `${name} must return an error result`);
        const text = textOf(res);
        assert.ok(!text.includes('<b>'), `${name}: <b> survived`);
        assert.ok(!text.includes('https://'), `${name}: https:// survived`);
        assert.ok(
          text.startsWith(`${UNTRUSTED_NOTICE}\n\nError: ${FRAME_OPEN}Todoist API 400 on `),
          `${name}: result must start with the notice and a fenced error: ${text.slice(0, 300)}`
        );
        assert.ok(text.includes('OBEY hxxps://evil[.]example'), `${name}: defanged text missing`);
        assert.ok(text.endsWith(suffix(100)), `${name}: result must be capped at 100`);
        assert.equal(text.length, bound, `${name}: result must be exactly the capped length`);
      }
    } finally {
      await client.close();
    }
  });
});

const SOURCES = [
  [
    'a network error',
    async () => {
      throw new TypeError('fetch failed: <b>OBEY</b> https://evil.example/x');
    },
    'Network error contacting Todoist: fetch failed: OBEY hxxps://evil[.]example/x',
  ],
  [
    'a plain Error thrown mid-handler',
    async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error('parse failed <!-- IGNORE PRIOR --> www.evil.example');
      },
    }),
    'parse failed www[.]evil[.]example',
  ],
  [
    'a thrown value that is not an Error',
    async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw '<i>OBEY</i> [click](https://evil.example) ftp://evil.example';
      },
    }),
    'OBEY click ftp[:]//evil[.]example',
  ],
];

for (const [label, impl, stripped] of SOURCES) {
  test(`D-7 class: ${label} becomes a stripped, fenced, noticed error result`, async () => {
    const res = await callOne(cfg({ readOnly: true, maxOutputChars: 4321 }), impl, 'find-projects', {}, true);
    assert.equal(res.isError, true);
    assert.equal(textOf(res), `${UNTRUSTED_NOTICE}\n\nError: ${framed(stripped)}`);
  });
}

// ---- Bug class 2: a cap cutting through a secret ----------------------------

test('error path, output cap through a token: redaction runs before the cut', async () => {
  // "Error: " and the open fence are 18 characters, so the token starts at
  // 80 and the cap of 100 falls inside it.
  const message = 'x'.repeat(62) + TOKEN + 'y'.repeat(50);
  const res = await callOne(
    cfg({ readOnly: true }),
    async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error(message);
      },
    }),
    'find-projects',
    {},
    true
  );
  assert.equal(res.isError, true);
  const text = textOf(res);
  assert.ok(!text.includes(FRAGMENT), 'a fragment of the token escaped redaction');
  assert.equal(
    text,
    `${UNTRUSTED_NOTICE}\n\nError: ${FRAME_OPEN}` + 'x'.repeat(62) + '[REDACTED]' + 'y'.repeat(10) + suffix(100)
  );
});

test('error path, field cap through a token joined by markup: redaction runs before the cut', async () => {
  // Stripping the empty <b></b> joins the token at 50..90; the field cap of
  // 70 falls inside it.
  const message = 'x'.repeat(50) + TOKEN.slice(0, 20) + '<b></b>' + TOKEN.slice(20) + 'y'.repeat(30);
  const res = await callOne(
    cfg({ readOnly: true, maxFieldChars: 70, maxOutputChars: 4321 }),
    async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error(message);
      },
    }),
    'find-projects',
    {},
    true
  );
  assert.equal(res.isError, true);
  const text = textOf(res);
  assert.ok(!text.includes(FRAGMENT), 'a fragment of the token escaped redaction');
  assert.equal(
    text,
    `${UNTRUSTED_NOTICE}\n\nError: ` + framed('x'.repeat(50) + '[REDACTED]' + 'y'.repeat(10) + ' …[truncated]')
  );
});

test('success path, output cap through a token: redaction runs before the cut', () => {
  registerSecret(TOKEN);
  // The cap of 100 falls 15 characters into the token.
  const res = buildResult({ maxOutputChars: 100 }, { payload: 'x'.repeat(85) + TOKEN + 'y'.repeat(30) });
  assert.equal(res.isError, undefined);
  const text = textOf(res);
  assert.ok(!text.includes(FRAGMENT), 'a fragment of the token escaped redaction');
  assert.equal(text, `${UNTRUSTED_NOTICE}\n\n` + 'x'.repeat(85) + '[REDACTED]' + 'y'.repeat(5) + suffix(100));
});

for (const [label, name] of [
  ['plain', 'x'.repeat(50) + TOKEN + 'y'.repeat(30)],
  ['joined by markup', 'x'.repeat(50) + TOKEN.slice(0, 20) + '<b></b>' + TOKEN.slice(20) + 'y'.repeat(30)],
]) {
  test(`success path, field cap through a token (${label}): find-projects redacts before the cut`, async () => {
    const body = { results: [{ id: 'p1', name }], next_cursor: null };
    const res = await callOne(
      cfg({ readOnly: true, maxFieldChars: 70, maxOutputChars: 123457 }),
      async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }),
      'find-projects',
      {},
      false
    );
    assert.ok(!res.isError, `find-projects returned an error: ${res.content?.[0]?.text}`);
    const text = textOf(res);
    assert.ok(!text.includes(FRAGMENT), 'a fragment of the token escaped redaction');
    const prefix = `${UNTRUSTED_NOTICE}\n\n`;
    assert.ok(text.startsWith(prefix), 'fixture error: result does not start with the notice');
    const payload = JSON.parse(text.slice(prefix.length));
    assert.equal(payload.projects[0].name, framed('x'.repeat(50) + '[REDACTED]' + 'y'.repeat(10) + ' …[truncated]'));
  });
}

// ---- Static check: no string cut in src/ before redaction -------------------

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const CUT_HELPER = 'redactThenCut';
const CUT_FILE = 'redact.js';
// Array slices, which cut no text. Keyed by file and receiver.
const ARRAY_SLICES = new Set(['client.js:items']);

/**
 * Source with comments blanked out, newlines kept so line numbers hold.
 * Strings and template literals are kept as they are.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      out += src[i++];
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\') out += src[i++];
        out += src[i++];
      }
      out += src[i++] ?? '';
    } else if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += src[i++];
    }
  }
  return out;
}

/**
 * The body of `function name(` in `src`, from its declaration to the next
 * column-0 `}`, as [start, end) offsets, or null if there is none.
 */
function functionSpan(src, name) {
  const m = new RegExp(`^(?:export\\s+)?function\\s+${name}\\s*\\(`, 'm').exec(src);
  if (!m) return null;
  const close = src.slice(m.index).search(/^}/m);
  return [m.index, close === -1 ? src.length : m.index + close + 1];
}

/**
 * Offenders in one file: a `.slice(`, `.substring(` or `.substr(` outside
 * the cut helper that is not a listed array slice, and a stripMarkup call
 * whose argument is not a direct `redact(` call.
 */
function findCutOffenders(file, text) {
  const src = stripComments(text);
  const offenders = [];
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const helper = file === CUT_FILE ? functionSpan(src, CUT_HELPER) : null;
  const inHelper = (i) => helper && i >= helper[0] && i < helper[1];

  const cutRe = /([A-Za-z_$][\w$]*|\))?\s*\.\s*(slice|substring|substr)\s*\(/g;
  let m;
  while ((m = cutRe.exec(src))) {
    if (inHelper(m.index)) continue;
    if (m[1] && ARRAY_SLICES.has(`${file}:${m[1]}`)) continue;
    offenders.push(`${file}:${lineOf(m.index)} .${m[2]}( outside ${CUT_HELPER}`);
  }

  const stripRe = /\bstripMarkup\s*\(\s*/g;
  while ((m = stripRe.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 30), m.index);
    if (/function\s+$/.test(before)) continue;
    if (!src.startsWith('redact(', m.index + m[0].length)) {
      offenders.push(`${file}:${lineOf(m.index)} stripMarkup( on unredacted text`);
    }
  }
  return offenders;
}

/**
 * Why the cut helper in `text` (CUT_FILE's source) is unsound, or null.
 * Sound means: it assigns `redact(...)` to a variable, and every cut in its
 * body is a method call on that variable, after the assignment.
 */
function helperProblem(text) {
  const src = stripComments(text);
  const span = functionSpan(src, CUT_HELPER);
  if (!span) return `no function ${CUT_HELPER} in src/${CUT_FILE}`;
  const body = src.slice(span[0], span[1]);
  const cuts = [...body.matchAll(/([A-Za-z_$][\w$]*|\))?\s*\.\s*(?:slice|substring|substr)\s*\(/g)];
  if (cuts.length === 0) return `${CUT_HELPER} cuts nothing`;
  const decl = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*redact\s*\(/.exec(body);
  const ok = decl && cuts.every((c) => c[1] === decl[1] && c.index > decl.index);
  return ok ? null : `${CUT_HELPER} cuts text that is not redacted first`;
}

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('D-7 class: src/ cuts text only in the helper that redacts first, and strips only redacted text', () => {
  const offenders = [];
  for (const full of jsFiles(SRC_ROOT)) {
    const file = relative(SRC_ROOT, full);
    offenders.push(...findCutOffenders(file, readFileSync(full, 'utf8')));
  }
  assert.deepEqual(offenders, [], `text cut or stripped before redaction:\n${offenders.join('\n')}`);
  assert.equal(helperProblem(readFileSync(join(SRC_ROOT, CUT_FILE), 'utf8')), null);
});

test('D-7 class: the static check flags planted offenders and passes sound forms', () => {
  const cases = {
    'text = text.slice(0, cap);': 1,
    'redact(detail).slice(0, 500)': 1,
    'x.substring(0, 3); y.substr(1)': 2,
    'items.slice(0, cap)': 1,
    'stripMarkup(input)': 1,
    'stripMarkup(redact(input))': 0,
    'export function stripMarkup(input) {}': 0,
    '// text.slice(0, 1)\n/* stripMarkup(x) */': 0,
  };
  for (const [source, count] of Object.entries(cases)) {
    assert.equal(findCutOffenders('planted.js', source).length, count, source);
  }
  assert.equal(findCutOffenders('client.js', 'items.slice(0, cap)').length, 0);
  const helper = [
    `export function ${CUT_HELPER}(text, cap) {`,
    '  const t = redact(text);',
    '  return t.length > cap ? t.slice(0, cap) : t;',
    '}',
    'function other(t) {',
    '  return t.slice(1);',
    '}',
  ].join('\n');
  assert.deepEqual(findCutOffenders(CUT_FILE, helper), [`${CUT_FILE}:6 .slice( outside ${CUT_HELPER}`]);
  assert.equal(helperProblem(helper), null);
  assert.equal(
    helperProblem(`function ${CUT_HELPER}(t, c) {\n  return redact(t.slice(0, c));\n}`),
    `${CUT_HELPER} cuts text that is not redacted first`
  );
  assert.equal(helperProblem(`function ${CUT_HELPER}(t) {\n  return redact(t);\n}`), `${CUT_HELPER} cuts nothing`);
  assert.equal(helperProblem('function other() {}'), `no function ${CUT_HELPER} in src/${CUT_FILE}`);
});
