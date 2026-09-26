import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { FRAME_OPEN, FRAME_CLOSE, UNTRUSTED_NOTICE } from '../src/sanitize.js';

/**
 * D-24 (docs/SPEC.md section 10): a registered token split by markup
 * survives the HTTP error body's 500-character cut. The cut ran before
 * safeField stripped the markup, so it kept part of the token, and
 * stripping then joined that part into a contiguous fragment neither
 * later redaction recognized.
 *
 * Decision this file tests (recorded under D-24 and R12): no text is cut
 * before it has been redacted, stripped and redacted again.
 *
 * Every cut point on both paths gets a token split by markup, with the
 * cut at every position inside it:
 *   - the former 500-character cut on an HTTP error body, at every
 *     position inside the raw token-plus-markup sequence;
 *   - safeField's field cap and capOutput's output cap on the error path,
 *     with the token past raw character 500 so the former cut would drop
 *     it, at every position inside the joined token;
 *   - the same two caps on the success path, at every position inside the
 *     joined token. The success path never had the 500-character cut, so
 *     these pin behavior that already holds.
 *
 * Expected outputs are written out here, not computed with stripMarkup or
 * safeField. Fixture values avoid the implementation defaults, per SPEC
 * section 8: maxFieldChars 1500 (default 2000), maxItems 37 (default 200),
 * maxOutputChars 4321 or 123457 (default 50000).
 *
 * Bug class: text cut before it is stripped. The static check at the end
 * allows a cut in src/ only inside redactThenCut, calls to it only from
 * safeField (after stripMarkup(redact(...))) and capOutput, and capOutput
 * only as buildResult's outermost call, so nothing strips its output.
 */

const framed = (s) => `${FRAME_OPEN}${s}${FRAME_CLOSE}`;
const suffix = (cap) =>
  `\n\n…[output truncated at ${cap} characters to bound context; refine your query or narrow the request]`;
const FIELD_CUT = ' …[truncated]';

// A 40-character hex token, the form Todoist issues. D-24's reproduction
// token.
const TOKEN = '7c1e9a40d3b85f26e1a0c94b7d2f58e3a6b1c0d9';
// The token split by empty markup that stripping removes: 47 characters.
const SPLIT = TOKEN.slice(0, 20) + '<b></b>' + TOKEN.slice(20);
const TAIL = 'y'.repeat(60);
const PREFIX = 'Todoist API 400 on GET /projects: ';

// Every position strictly inside a sequence of `n` characters.
const inside = (n) => Array.from({ length: n - 1 }, (_, i) => i + 1);

const cfg = (over = {}) => ({
  apiKey: TOKEN,
  readOnly: true,
  maxOutputChars: 4321,
  maxFieldChars: 1500,
  maxItems: 37,
  ...over,
});

async function connect(c) {
  const { server } = createServer(c);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Call find-projects with fetch replaced, asserting whether it errored. */
async function findProjects(c, fetchImpl, expectError) {
  const orig = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const client = await connect(c);
    try {
      const res = await client.callTool({ name: 'find-projects', arguments: {} });
      assert.equal(res.isError === true, expectError, `find-projects: ${res.content?.[0]?.text}`);
      return res.content.map((x) => x.text).join('\n');
    } finally {
      await client.close();
    }
  } finally {
    globalThis.fetch = orig;
  }
}

const upstream400 = (body) => async () => ({ ok: false, status: 400, text: async () => body });
const upstream200 = (name) => async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ results: [{ id: 'p1', name }], next_cursor: null }),
});

/** Fails if any 8 consecutive characters of the token appear in `text`. */
function assertNoTokenPiece(text, label) {
  for (let i = 0; i + 8 <= TOKEN.length; i++) {
    const piece = TOKEN.slice(i, i + 8);
    assert.ok(!text.includes(piece), `${label}: token characters ${i}..${i + 7} (${piece}) escaped redaction`);
  }
}

// ---- D-24's reproduction input ----------------------------------------------

test('D-24 reproduction: a token split by markup at raw character 485 is redacted whole', async () => {
  const body = 'x'.repeat(465) + SPLIT;
  const text = await findProjects(cfg(), upstream400(body), true);
  assertNoTokenPiece(text, 'reproduction');
  assert.equal(text, `${UNTRUSTED_NOTICE}\n\nError: ` + framed(PREFIX + 'x'.repeat(465) + '[REDACTED]'));
});

// ---- The former 500-character cut, error path -------------------------------

test('error path, former 500-character cut: a markup-split token at every position is redacted whole', async () => {
  for (const j of inside(SPLIT.length)) {
    // Raw body character 500 falls j characters into the split token.
    const pad = 'x'.repeat(500 - j);
    const text = await findProjects(cfg(), upstream400(pad + SPLIT + TAIL), true);
    const label = `500-character cut ${j} into the split token`;
    assertNoTokenPiece(text, label);
    assert.equal(text, `${UNTRUSTED_NOTICE}\n\nError: ` + framed(PREFIX + pad + '[REDACTED]' + TAIL), label);
  }
});

// ---- The field cap and the output cap, error path ---------------------------

// The split token starts at raw body character 600, past the former cut.
const ERR_PAD = 'x'.repeat(600);
const ERR_CLEAN = PREFIX + ERR_PAD + '[REDACTED]' + TAIL;

test('error path, field cap: a markup-split token past raw character 500, cut at every position, is redacted first', async () => {
  for (const j of inside(TOKEN.length)) {
    // After stripping, the token starts at PREFIX.length + 600.
    const cap = PREFIX.length + ERR_PAD.length + j;
    const text = await findProjects(cfg({ maxFieldChars: cap }), upstream400(ERR_PAD + SPLIT + TAIL), true);
    const label = `field cap ${j} into the joined token`;
    assertNoTokenPiece(text, label);
    assert.equal(
      text,
      `${UNTRUSTED_NOTICE}\n\nError: ` + framed(ERR_CLEAN.slice(0, cap) + FIELD_CUT),
      label
    );
  }
});

test('error path, output cap: a markup-split token past raw character 500, cut at every position, is redacted first', async () => {
  const whole = 'Error: ' + framed(ERR_CLEAN);
  const at = 'Error: '.length + FRAME_OPEN.length + PREFIX.length + ERR_PAD.length;
  for (const j of inside(TOKEN.length)) {
    const cap = at + j;
    const text = await findProjects(cfg({ maxOutputChars: cap }), upstream400(ERR_PAD + SPLIT + TAIL), true);
    const label = `output cap ${j} into the joined token`;
    assertNoTokenPiece(text, label);
    assert.equal(text, `${UNTRUSTED_NOTICE}\n\n` + whole.slice(0, cap) + suffix(cap), label);
  }
});

// ---- The field cap and the output cap, success path -------------------------

const OK_PAD = 'x'.repeat(50);
const OK_CLEAN = OK_PAD + '[REDACTED]' + TAIL;

test('success path, field cap: a markup-split token cut at every position is redacted first', async () => {
  for (const j of inside(TOKEN.length)) {
    const cap = OK_PAD.length + j;
    const text = await findProjects(
      cfg({ maxFieldChars: cap, maxOutputChars: 123457 }),
      upstream200(OK_PAD + SPLIT + TAIL),
      false
    );
    const label = `field cap ${j} into the joined token`;
    assertNoTokenPiece(text, label);
    const prefix = `${UNTRUSTED_NOTICE}\n\n`;
    assert.ok(text.startsWith(prefix), `${label}: result does not start with the notice`);
    const payload = JSON.parse(text.slice(prefix.length));
    assert.equal(payload.projects[0].name, framed(OK_CLEAN.slice(0, cap) + FIELD_CUT), label);
  }
});

test('success path, output cap: a markup-split token cut at every position is redacted first', async () => {
  const prefix = `${UNTRUSTED_NOTICE}\n\n`;
  const uncut = await findProjects(cfg({ maxOutputChars: 123457 }), upstream200(OK_PAD + SPLIT + TAIL), false);
  assertNoTokenPiece(uncut, 'uncut');
  assert.ok(uncut.startsWith(prefix), 'uncut result does not start with the notice');
  const whole = uncut.slice(prefix.length);
  assert.equal(JSON.parse(whole).projects[0].name, framed(OK_CLEAN));
  const at = whole.indexOf('[REDACTED]');
  for (const j of inside(TOKEN.length)) {
    const cap = at + j;
    const text = await findProjects(cfg({ maxOutputChars: cap }), upstream200(OK_PAD + SPLIT + TAIL), false);
    const label = `output cap ${j} into the joined token`;
    assertNoTokenPiece(text, label);
    assert.equal(text, prefix + whole.slice(0, cap) + suffix(cap), label);
  }
});

// ---- Static check: no text cut before it is stripped ------------------------

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const CUT_HELPER = 'redactThenCut';
const CUT_FILE = 'redact.js';
// The only functions that may call the cut helper, and where they live.
const CUT_CALLERS = { safeField: 'sanitize.js', capOutput: 'sanitize.js' };
// The only function that may call capOutput.
const CAP_CALLER = { name: 'buildResult', file: 'result.js' };
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

/** [start, end) of `function name(`'s body, to the next column-0 `}`. */
function functionSpan(src, name) {
  const m = new RegExp(`^(?:export\\s+)?function\\s+${name}\\s*\\(`, 'm').exec(src);
  if (!m) return null;
  const close = src.slice(m.index).search(/^}/m);
  return [m.index, close === -1 ? src.length : m.index + close + 1];
}

/** The name of the column-0 function enclosing offset `i`, or null. */
function enclosingFunction(src, i) {
  const re = /^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  let name = null;
  while ((m = re.exec(src)) && m.index <= i) {
    const span = functionSpan(src, m[1]);
    name = span && i < span[1] ? m[1] : null;
  }
  return name;
}

/** The argument text of the call whose `(` is at `open`. */
function argsAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/**
 * Offenders in one file of src/, as "file:line reason" strings:
 *   - a text cut outside the cut helper, as a method call or a computed
 *     member (`text['slice'](...)`), unless it is a listed array slice;
 *   - a call to the cut helper outside safeField and capOutput;
 *   - in safeField, a cut whose argument is not a variable that was set
 *     from stripMarkup(redact(...)) and afterwards only from itself;
 *   - a capOutput call outside buildResult, or not a whole operand there;
 *   - a stripMarkup or safeField call whose argument contains a call to
 *     the cut helper or to capOutput.
 */
function findOffenders(file, text) {
  const src = stripComments(text);
  const out = [];
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const helper = file === CUT_FILE ? functionSpan(src, CUT_HELPER) : null;
  const inHelper = (i) => helper && i >= helper[0] && i < helper[1];

  const cutRe =
    /([A-Za-z_$][\w$]*|\))?\s*(?:\.\s*(slice|substring|substr)\s*\(|\[\s*(['"`])(slice|substring|substr)\3\s*\])/g;
  let m;
  while ((m = cutRe.exec(src))) {
    if (inHelper(m.index)) continue;
    if (m[2] && m[1] && ARRAY_SLICES.has(`${file}:${m[1]}`)) continue;
    out.push(`${file}:${lineOf(m.index)} ${m[2] ? `.${m[2]}(` : `['${m[4]}']`} outside ${CUT_HELPER}`);
  }

  const callRe = (name) => new RegExp(`\\b${name}\\s*\\(`, 'g');
  const isDeclaration = (i) => /function\s+$/.test(src.slice(Math.max(0, i - 30), i));

  for (const c of src.matchAll(callRe(CUT_HELPER))) {
    if (isDeclaration(c.index)) continue;
    const fn = enclosingFunction(src, c.index);
    if (CUT_CALLERS[fn] !== file) {
      out.push(`${file}:${lineOf(c.index)} ${CUT_HELPER}( called outside safeField and capOutput`);
      continue;
    }
    if (fn === 'safeField') {
      // The first argument. One containing a comma fails the identifier
      // test below, so it is flagged rather than misread.
      const arg = argsAt(src, c.index + c[0].length - 1).split(',')[0].trim();
      const span = functionSpan(src, 'safeField');
      const body = src.slice(span[0], c.index);
      const decl = new RegExp(`\\b(?:let|const)\\s+${arg}\\s*=\\s*stripMarkup\\s*\\(\\s*redact\\s*\\(`).exec(body);
      const assigns = [...body.matchAll(new RegExp(`(?<![\\w$.])${arg}\\s*=(?!=)\\s*([^;]*)`, 'g'))].filter(
        (a) => !decl || a.index !== body.indexOf(arg, decl.index)
      );
      const sound =
        /^[A-Za-z_$][\w$]*$/.test(arg) && decl && assigns.every((a) => a.index > decl.index && a[1].trim().startsWith(arg));
      if (!sound) out.push(`${file}:${lineOf(c.index)} safeField cuts text not set from stripMarkup(redact(...))`);
    }
  }

  for (const c of src.matchAll(callRe('capOutput'))) {
    if (isDeclaration(c.index)) continue;
    const fn = enclosingFunction(src, c.index);
    const before = src.slice(0, c.index).trimEnd();
    if (file !== CAP_CALLER.file || fn !== CAP_CALLER.name) {
      out.push(`${file}:${lineOf(c.index)} capOutput( called outside ${CAP_CALLER.name}`);
    } else if (!/[=?:]$/.test(before)) {
      out.push(`${file}:${lineOf(c.index)} capOutput( is not a whole operand, so its output may be stripped`);
    }
  }

  for (const name of ['stripMarkup', 'safeField']) {
    for (const c of src.matchAll(callRe(name))) {
      if (isDeclaration(c.index)) continue;
      const arg = argsAt(src, c.index + c[0].length - 1);
      if (new RegExp(`\\b(?:${CUT_HELPER}|capOutput)\\s*\\(`).test(arg)) {
        out.push(`${file}:${lineOf(c.index)} ${name}( takes text that was already cut`);
      }
    }
  }
  return out;
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

test('D-24 class: src/ cuts text only after it is redacted, stripped and redacted again', () => {
  const offenders = [];
  for (const full of jsFiles(SRC_ROOT)) {
    offenders.push(...findOffenders(relative(SRC_ROOT, full), readFileSync(full, 'utf8')));
  }
  assert.deepEqual(offenders, [], `text cut before it is stripped:\n${offenders.join('\n')}`);
});

test('D-24 class: the static check flags planted offenders and passes sound forms', () => {
  const cases = [
    // The D-24 site as it stood at 7286195.
    ['client.js', 'function request() {\n  return `x: ${redactThenCut(detail, 500).text}`;\n}', 1],
    ['shape.js', "function f(t) {\n  return t['slice'](0, 5);\n}", 1],
    ['shape.js', 'function f(t) {\n  return t["substring"](0, 5);\n}', 1],
    ['shape.js', 'function f(t) {\n  return t.substr(0, 5);\n}', 1],
    ['client.js', 'function g(items) {\n  return items.slice(0, cap);\n}', 0],
    ['shape.js', 'function f(items) {\n  return items.slice(0, cap);\n}', 1],
    // A cut before stripping inside safeField.
    [
      'sanitize.js',
      'export function safeField(input, cap) {\n  const t = redact(input);\n  const { text: k } = redactThenCut(t, cap);\n  return stripMarkup(redact(k));\n}',
      1,
    ],
    // A cut of a value reassigned from something other than itself.
    [
      'sanitize.js',
      'export function safeField(input, cap) {\n  let text = stripMarkup(redact(input));\n  text = input;\n  return redactThenCut(text, cap);\n}',
      1,
    ],
    // The sound form.
    [
      'sanitize.js',
      "export function safeField(input, cap) {\n  let text = stripMarkup(redact(input));\n  text = text.split('a').join('b');\n  return redactThenCut(text, cap);\n}",
      0,
    ],
    ['sanitize.js', 'export function capOutput(p, cap) {\n  return redactThenCut(p, cap);\n}', 0],
    ['result.js', 'export function buildResult(cfg) {\n  const body = x ? capOutput(a, 1) : capOutput(b, 2);\n}', 0],
    ['result.js', 'export function buildResult(cfg) {\n  const body = safeField(capOutput(a, 1));\n}', 2],
    ['result.js', 'export function buildResult(cfg) {\n  return stripMarkup(capOutput(a, 1));\n}', 2],
    ['shape.js', 'function f(a) {\n  return capOutput(a, 1);\n}', 1],
    ['shape.js', 'function f(a) {\n  return safeField(redactThenCut(a, 5).text, 9);\n}', 2],
    ['redact.js', `export function ${CUT_HELPER}(input, cap) {\n  const t = redact(input);\n  return t.slice(0, cap);\n}`, 0],
    ['shape.js', '// t.slice(0, 1)\n/* redactThenCut(x, 1) */', 0],
  ];
  for (const [file, source, count] of cases) {
    assert.equal(findOffenders(file, source).length, count, `${file}: ${source}\n${findOffenders(file, source).join('\n')}`);
  }
});
