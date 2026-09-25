import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { stripMarkup, safeField, FRAME_OPEN, FRAME_CLOSE, UNTRUSTED_NOTICE } from '../src/sanitize.js';

/**
 * D-6 (docs/SPEC.md section 10): defanging can be undone, and URL forms
 * other than a word-bounded http(s):// URL are never defanged. D-15's
 * entity-encoded comment is the same bug class.
 *
 * Decisions this file tests:
 *   1. Defanging runs last in stripMarkup, after every pass that can join
 *      or reveal text.
 *   2. Defanging covers any scheme followed by :// (letters, digits, +, .
 *      and - before the colon), matched even when letters immediately
 *      precede it, and bare www. hosts. http and https keep the hxxp /
 *      hxxps form; any other scheme has its colon bracketed, [:]//. Dots
 *      are bracketed in every case.
 *
 * Bug class: a neutralizing pass that runs before a pass that can join or
 * reveal text. Three checks cover it:
 *   - Exact expected outputs for D-6's and D-15's reproduction inputs and
 *     for the other instances found in stripMarkup, written out here and
 *     not computed with stripMarkup or safeField.
 *   - A static check over every named function in src/: a pass that
 *     neutralizes a pattern may not be followed by a pass that can join or
 *     reveal text unless both repeat together until nothing changes, and
 *     stripMarkup's last pass must be the URL defang. It fails closed on
 *     any call in stripMarkup it cannot classify.
 *   - A generative check over inputs combining split link syntax, numeric
 *     and named entities, HTML comments, tags and URL fragments.
 *
 * Fixture values avoid the implementation defaults, per SPEC section 8:
 * maxFieldChars 1500 (default 2000), maxOutputChars 123457 (default
 * 50000), maxItems 37 (default 200).
 */

const __filename = fileURLToPath(import.meta.url);
const SRC_ROOT = path.join(path.dirname(__filename), '..', 'src');

const framed = (s) => `${FRAME_OPEN}${s}${FRAME_CLOSE}`;

// ---- Exact outputs ------------------------------------------------------------

const EXACT = [
  // D-6's reproduction table, in order.
  ['D-6: scheme split by link syntax', 'ht[tp](x)://evil.example/path', 'hxxp://evil[.]example/path'],
  ['D-6: bare www. host', 'www.evil.example/path', 'www[.]evil[.]example/path'],
  [
    'D-6: www. host as a link label',
    '[www.evil.example/path](https://www.evil.example/path)',
    'www[.]evil[.]example/path',
  ],
  ['D-6: ftp scheme', 'ftp://evil.example/path', 'ftp[:]//evil[.]example/path'],
  ['D-6: letter-prefixed https', 'xhttps://evil.example/path', 'xhxxps://evil[.]example/path'],
  // D-15's entity-encoded comment: removed with its content, like a literal one.
  ['D-15: entity-encoded comment', 'a &lt;!-- IGNORE PRIOR --&gt; b', 'a b'],
  // Other instances of the class found in stripMarkup at c11aa6c.
  ['tag removal joins a comment opener', '<!<b></b>-- HIDDEN --> x', 'x'],
  ['link removal reveals a nested link', 'a[b[c](x)](https://evil.example/p)', 'abc'],
  // Other schemes, case and position.
  ['uppercase ftp scheme', 'FTP://evil.example', 'FTP[:]//evil[.]example'],
  ['scheme with + and .', 'git+ssh://evil.example/r', 'git+ssh[:]//evil[.]example/r'],
  [
    'second scheme inside a query string',
    'https://a.example/?u=ftp://b.example',
    'hxxps://a[.]example/?u=ftp[:]//b[.]example',
  ],
  ['uppercase WWW', 'WWW.Evil.Example', 'WWW[.]Evil[.]Example'],
  ['scheme separated from :// by a newline', 'see http\n://evil.example/x', 'see http\n[:]//evil[.]example/x'],
];

for (const [name, input, expected] of EXACT) {
  test(`D-6 exact output, stripMarkup: ${name}`, () => {
    assert.equal(stripMarkup(input), expected);
  });
  test(`D-6 exact output, safeField: ${name}`, () => {
    assert.equal(safeField(input, 1500), framed(expected));
  });
}

// ---- Tool level -------------------------------------------------------------------

const serverCfg = {
  apiKey: 'd6-test-token-000000',
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

test('D-6: find-tasks returns each reproduction input defanged, in content and description', async () => {
  const cases = EXACT.slice(0, 6);
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
      ['t0', framed('hxxp://evil[.]example/path'), framed('hxxp://evil[.]example/path')],
      ['t1', framed('www[.]evil[.]example/path'), framed('www[.]evil[.]example/path')],
      ['t2', framed('www[.]evil[.]example/path'), framed('www[.]evil[.]example/path')],
      ['t3', framed('ftp[:]//evil[.]example/path'), framed('ftp[:]//evil[.]example/path')],
      ['t4', framed('xhxxps://evil[.]example/path'), framed('xhxxps://evil[.]example/path')],
      ['t5', framed('a b'), framed('a b')],
    ]
  );
});

// ---- Static check: pass ordering ------------------------------------------------

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
  'new', 'await', 'in', 'of', 'do', 'else', 'throw', 'void', 'delete', 'case',
]);

/**
 * A small tokenizer, enough to find calls, string and regex literals and
 * brackets in src/. Template literal text is skipped; the expressions in
 * its ${...} slots are tokenized.
 */
function tokenize(src) {
  const toks = [];
  const tplStack = [];
  let depth = 0;
  let i = 0;
  const regexAllowed = () => {
    const prev = toks[toks.length - 1];
    if (!prev) return true;
    if (prev.type === 'punct') return !/^[)\]}]$/.test(prev.value);
    if (prev.type === 'ident') return KEYWORDS.has(prev.value);
    return false;
  };
  const readTemplate = (j) => {
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '`') return j + 1;
      if (c === '$' && src[j + 1] === '{') {
        tplStack.push(depth);
        depth++;
        return j + 2;
      }
      j++;
    }
    throw new Error('unterminated template literal');
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      toks.push({ type: 'string', value: src.slice(i + 1, j), start: i });
      i = j + 1;
    } else if (c === '`') {
      toks.push({ type: 'template', value: '`', start: i });
      i = readTemplate(i + 1);
    } else if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      for (; src[j] !== '/' || inClass; j++) {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
      }
      const body = src.slice(i + 1, j);
      j++;
      while (/[a-z]/.test(src[j])) j++;
      toks.push({ type: 'regex', value: body, start: i });
      i = j;
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (/[A-Za-z0-9_$]/.test(src[j])) j++;
      toks.push({ type: 'ident', value: src.slice(i, j), start: i });
      i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (/[0-9a-zA-Z_.]/.test(src[j])) j++;
      toks.push({ type: 'number', value: src.slice(i, j), start: i });
      i = j;
    } else if (c === '=' && src[i + 1] === '>') {
      toks.push({ type: 'punct', value: '=>', start: i });
      i += 2;
    } else if (c === '}' && tplStack.length && tplStack[tplStack.length - 1] === depth - 1) {
      tplStack.pop();
      depth--;
      i = readTemplate(i + 1);
    } else {
      if (c === '{') depth++;
      if (c === '}') depth--;
      toks.push({ type: 'punct', value: c, start: i });
      i++;
    }
  }
  return toks;
}

const OPEN = { '(': ')', '[': ']', '{': '}' };

/** Index of the bracket closing the one at `k`. */
function matchClose(toks, k) {
  const stack = [];
  for (let j = k; j < toks.length; j++) {
    const v = toks[j].type === 'punct' ? toks[j].value : null;
    if (v && OPEN[v]) stack.push(OPEN[v]);
    else if (v && v === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return j;
    }
  }
  throw new Error(`unbalanced bracket at token ${k}`);
}

/** Split the argument tokens between `open` and `close` at top-level commas. */
function args(toks, open, close) {
  const out = [[]];
  for (let j = open + 1; j < close; j++) {
    const v = toks[j].type === 'punct' ? toks[j].value : null;
    if (v && OPEN[v]) {
      const end = matchClose(toks, j);
      out[out.length - 1].push(...toks.slice(j, end + 1));
      j = end;
    } else if (v === ',') {
      out.push([]);
    } else {
      out[out.length - 1].push(toks[j]);
    }
  }
  return out;
}

/** Every named function declaration, with its body's token range. */
function namedFunctions(toks) {
  const fns = [];
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].type !== 'ident' || toks[k].value !== 'function') continue;
    let n = k + 1;
    if (toks[n]?.value === '*') n++;
    if (toks[n]?.type !== 'ident') continue;
    const paramsClose = matchClose(toks, n + 1);
    const bodyOpen = paramsClose + 1;
    fns.push({ name: toks[n].value, from: bodyOpen + 1, to: matchClose(toks, bodyOpen) });
  }
  return fns;
}

const CHAR_CLASS = /^\[(?:\\.|[^\]\\])*\](?:\{\d+,?\d*\}|\+)?$/;

/**
 * What a replacement can do to text:
 *   join       deletes text, so what is left on either side can meet
 *   reveal     turns an encoding into the text it stands for
 *   neutralize removes or breaks one pattern
 *   charclass  replaces every instance of each character in a class, so
 *              a later join cannot recreate one, but a later reveal can
 *   defang     the URL defang
 */
function classifyReplace(a1, a2) {
  const re = a1.length === 1 && a1[0].type === 'regex' ? a1[0].value : null;
  if (a2.length === 1 && a2[0].type === 'string') {
    const to = a2[0].value;
    if (to === '' || /^(\$\d)+$/.test(to)) return { join: true, neutralize: true };
    if (re !== null && re.startsWith('&')) return { reveal: true };
    if (re !== null && CHAR_CLASS.test(re)) return { charclass: true };
    return { neutralize: true };
  }
  if (a2.length === 1 && a2[0].type === 'ident' && a2[0].value === 'defangUrl') {
    return { defang: true, neutralize: true };
  }
  if (a2.some((t) => t.type === 'ident' && t.value === 'decodeCodePoint')) return { reveal: true };
  return { opaque: true, join: true, reveal: true, neutralize: true };
}

const PASS_CALLS = new Set(['replace', 'replaceAll', 'split', 'decodeHtmlEntities', 'stripMarkup', 'defangUrls']);
const STRIP_MARKUP_CALLS = new Set(['String', 'replace', 'decodeHtmlEntities', 'untilStable', 'defangUrls', 'trim']);

/**
 * Report every instance of the bug class in one file's source. Returns
 * strings naming the function and the two passes.
 */
function orderingViolations(src, file) {
  const toks = tokenize(src);
  const fns = namedFunctions(toks);
  const out = [];
  const owner = (k) => {
    let best = null;
    for (const f of fns) if (k >= f.from && k < f.to && (!best || f.from > best.from)) best = f;
    return best;
  };
  const byFn = new Map();
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type !== 'ident' || toks[k + 1]?.value !== '(' || KEYWORDS.has(t.value)) continue;
    if (toks[k - 1]?.value === 'function') continue;
    const isMethod = toks[k - 1]?.value === '.';
    const fn = owner(k);
    const where = `${file}:${src.slice(0, t.start).split('\n').length}`;
    if (fn?.name === 'stripMarkup' && !STRIP_MARKUP_CALLS.has(t.value)) {
      out.push(`${where}: stripMarkup calls ${t.value}(), which this check cannot classify`);
    }
    if (!PASS_CALLS.has(t.value)) continue;
    if (!fn) {
      out.push(`${where}: ${t.value}() rewrites text outside a named function`);
      continue;
    }
    const close = matchClose(toks, k + 1);
    let kind;
    let label = `${t.value}()`;
    if (isMethod && (t.value === 'replace' || t.value === 'replaceAll')) {
      const [a1 = [], a2 = []] = args(toks, k + 1, close);
      kind = classifyReplace(a1, a2);
      if (a1[0]?.type === 'regex') label = `${t.value}(/${a1[0].value}/)`;
    } else if (isMethod && t.value === 'split') {
      if (toks[close + 1]?.value !== '.' || toks[close + 2]?.value !== 'join') continue;
      const [a2 = []] = args(toks, close + 3, matchClose(toks, close + 3));
      const to = a2.length === 1 && a2[0].type === 'string' ? a2[0].value : null;
      kind = to === null ? { opaque: true, join: true, reveal: true, neutralize: true }
        : to === '' ? { join: true, neutralize: true } : { neutralize: true };
      label = 'split().join()';
    } else if (isMethod) {
      continue;
    } else if (t.value === 'decodeHtmlEntities') {
      kind = { reveal: true };
    } else if (t.value === 'stripMarkup') {
      kind = { join: true, reveal: true };
    } else {
      kind = { defang: true, neutralize: true };
    }
    // Innermost untilStable(...) call enclosing this pass, if any.
    let group = null;
    for (let g = k - 1; g >= fn.from; g--) {
      if (toks[g].value === 'untilStable' && toks[g + 1]?.value === '(' && matchClose(toks, g + 1) > k) {
        group = g;
        break;
      }
    }
    if (!byFn.has(fn)) byFn.set(fn, []);
    byFn.get(fn).push({ ...kind, group, label: `${where} ${label}` });
  }
  for (const [fn, passes] of byFn) {
    passes.forEach((p, i) => {
      if (p.group !== null && !(p.join && p.neutralize && !p.opaque && !p.reveal)) {
        out.push(`${fn.name}: ${p.label} repeats until stable but does not only delete text`);
      }
      for (const q of passes.slice(i + 1)) {
        if (p.group !== null && p.group === q.group) continue;
        if ((p.neutralize || p.defang) && (q.join || q.reveal)) {
          out.push(`${fn.name}: ${p.label} runs before ${q.label}, which can join or reveal text`);
        } else if (p.charclass && q.reveal) {
          out.push(`${fn.name}: ${p.label} runs before ${q.label}, which can reveal text`);
        }
      }
    });
    if (fn.name === 'stripMarkup' && !passes[passes.length - 1]?.defang) {
      out.push(`stripMarkup: its last pass is ${passes[passes.length - 1]?.label}, not the URL defang`);
    }
  }
  const strip = fns.find((f) => f.name === 'stripMarkup');
  if (strip && !byFn.get(strip)?.some((p) => p.defang)) {
    out.push('stripMarkup: no URL defang pass');
  }
  return out;
}

function srcFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? srcFiles(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []
  );
}

test('D-6 class: no pass in src/ neutralizes text before a pass that can join or reveal it', () => {
  const files = srcFiles(SRC_ROOT);
  assert.ok(files.some((f) => f.endsWith('sanitize.js')), 'fixture error: src/sanitize.js not found');
  const violations = files.flatMap((f) =>
    orderingViolations(fs.readFileSync(f, 'utf8'), path.relative(SRC_ROOT, f))
  );
  assert.deepEqual(violations, []);
});

// The detector itself, on planted sources, so each kind of report is shown
// to fire and the check is not green only because it finds nothing.

test('D-6 class check: reports a defang that runs before link removal', () => {
  const planted = `export function stripMarkup(input) {
    let text = String(input);
    text = defangUrls(text);
    text = text.replace(/!?\\[([^\\]]*)\\]\\([^)]*\\)/g, '$1');
    return text;
  }`;
  const v = orderingViolations(planted, 'planted.js');
  assert.ok(v.some((s) => /defangUrls\(\) runs before .*which can join/.test(s)), v.join('\n'));
  assert.ok(v.some((s) => /last pass is .*not the URL defang/.test(s)), v.join('\n'));
});

test('D-6 class check: reports comment removal before entity decoding', () => {
  const planted = `export function stripMarkup(input) {
    let text = String(input);
    text = text.replace(/<!--[\\s\\S]*?-->/g, '');
    text = decodeHtmlEntities(text);
    return defangUrls(text);
  }`;
  const v = orderingViolations(planted, 'planted.js');
  assert.deepEqual(v, [
    'stripMarkup: planted.js:3 replace(/<!--[\\s\\S]*?-->/) runs before planted.js:4 decodeHtmlEntities(), which can join or reveal text',
  ]);
});

test('D-6 class check: accepts removals that repeat together, and rejects a growing pass among them', () => {
  const ok = `export function stripMarkup(input) {
    let text = decodeHtmlEntities(String(input));
    text = untilStable(text, (t) => t.replace(/<!--[\\s\\S]*?-->/g, '').replace(/<[a-z][^>]*>/g, ''));
    text = text.replace(/[<>]/g, ' ');
    return defangUrls(text);
  }`;
  assert.deepEqual(orderingViolations(ok, 'planted.js'), []);
  const grows = ok.replace(`/<[a-z][^>]*>/g, ''`, `/<[a-z][^>]*>/g, ' '`);
  const v = orderingViolations(grows, 'planted.js');
  assert.ok(v.some((s) => /repeats until stable but does not only delete text/.test(s)), v.join('\n'));
});

test('D-6 class check: reports a character-class pass before a reveal, anywhere in src/', () => {
  const planted = `function helper(s) {
    s = s.replace(/[<>]/g, ' ');
    return decodeHtmlEntities(s);
  }`;
  const v = orderingViolations(planted, 'planted.js');
  assert.deepEqual(v, [
    'helper: planted.js:2 replace(/[<>]/) runs before planted.js:3 decodeHtmlEntities(), which can reveal text',
  ]);
});

test('D-6 class check: fails closed on an unknown call in stripMarkup, an opaque replacement, and a rewrite outside a function', () => {
  const planted = `const x = 'a'.replace(/a/g, 'b');
  export function stripMarkup(input) {
    let text = String(input);
    text = somethingNew(text);
    text = text.replace(/x/g, (m) => m + m);
    text = text.split('a').join('');
    return defangUrls(text);
  }`;
  const v = orderingViolations(planted, 'planted.js');
  assert.ok(v.some((s) => /planted\.js:1: replace\(\) rewrites text outside a named function/.test(s)), v.join('\n'));
  assert.ok(v.some((s) => /stripMarkup calls somethingNew\(\)/.test(s)), v.join('\n'));
  assert.ok(v.some((s) => /stripMarkup calls split\(\)/.test(s)), v.join('\n'));
  assert.ok(v.some((s) => /replace\(\/x\/\) runs before .*split\(\)\.join\(\)/.test(s)), v.join('\n'));
});

// ---- Generative check ---------------------------------------------------------------

/**
 * The property: no scheme:// survives unbroken, and no www. host keeps a
 * live dot. A scheme is the whole run of scheme characters before the
 * colon, so a letter-prefixed scheme is checked in full; only a run ending
 * in hxxp or hxxps may keep its ://.
 */
function urlLeaks(out) {
  const leaks = [];
  for (const m of out.matchAll(/(?<![a-z0-9+.-])([a-z0-9+.-]*):\/\//gi)) {
    if (!/hxxps?$/i.test(m[1])) leaks.push(`unbroken "${m[0]}"`);
  }
  if (/www\./i.test(out)) leaks.push('www. with a live dot');
  if (/www\[\.\](?:[a-z0-9-]|\[\.\])*\./i.test(out)) leaks.push('www[.] host with a live dot');
  return leaks;
}

const BASES = [
  'http://evil.example/p',
  'https://evil.example/p?q=1#frag',
  'HTTPS://Evil.Example/p',
  'ftp://evil.example/p',
  'git+ssh://evil.example/r.git',
  'x-custom.v2://evil.example',
  'xhttps://evil.example/p',
  'https://user@evil.example:8080/a.b/c',
  'https://a.example/?next=ftp://b.example/c',
  'https://evil.example/?a=1&b=2',
  'www.evil.example/p',
  'WWW.evil.example',
  'www.a.example/p?x=www.c.example',
];

// Text dropped between two halves of a URL: removed by stripMarkup, so the
// halves meet.
const SPLITTERS = [
  (a, b) => `${a}<!-- x -->${b}`,
  (a, b) => `${a}<!---->${b}`,
  (a, b) => `${a}&lt;!-- x --&gt;${b}`,
  (a, b) => `${a}<b></b>${b}`,
  (a, b) => `${a}&lt;i&gt;&lt;/i&gt;${b}`,
  (a, b) => `${a}<!<b></b>-- x -->${b}`,
  (a, b) => `${a}[](x)${b}`,
  (a, b) => `${a}![](https://t.example/i.png)${b}`,
];

// One character written as an entity.
const code = (ch) => ch.codePointAt(0);
const ENCODERS = [
  (ch) => `&#${code(ch)};`,
  (ch) => `&#x${code(ch).toString(16)};`,
  (ch) => `&#X${code(ch).toString(16).toUpperCase()};`,
  (ch) => `&#000${code(ch)};`,
  (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch] ?? `&#${code(ch)};`,
];

// A run of the URL made into a link label; the label is kept, the link
// syntax removed.
const WRAPPERS = [
  (s) => `[${s}](x)`,
  (s) => `[${s}](https://t.example/)`,
  (s) => `![${s}]()`,
  (s) => `[[${s}](x)](y)`,
];

const CONTEXTS = [
  ['', ''],
  ['see ', ' now'],
  ['x', '.'],
  ['**', '**'],
  ['(', ')'],
];

function* generatedCases() {
  for (const base of BASES) {
    for (let k = 1; k < base.length; k++) {
      for (const split of SPLITTERS) yield split(base.slice(0, k), base.slice(k));
    }
    for (let k = 0; k < base.length; k++) {
      for (const enc of ENCODERS) yield base.slice(0, k) + enc(base[k]) + base.slice(k + 1);
    }
    for (let i = 0; i < base.length; i++) {
      for (let len = 1; len <= 3 && i + len <= base.length; len++) {
        for (const wrap of WRAPPERS) {
          yield base.slice(0, i) + wrap(base.slice(i, i + len)) + base.slice(i + len);
        }
      }
    }
  }
  // Compositions: two to four of the transformations above, applied in
  // turn at seeded random positions, each wrapped in a random context.
  let seed = 0x6d2b79f5;
  const rand = (n) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % n);
  };
  for (let n = 0; n < 4000; n++) {
    let s = BASES[rand(BASES.length)];
    const steps = 2 + rand(3);
    for (let step = 0; step < steps; step++) {
      const kind = rand(3);
      if (kind === 0) {
        const k = 1 + rand(s.length - 1);
        s = SPLITTERS[rand(SPLITTERS.length)](s.slice(0, k), s.slice(k));
      } else if (kind === 1) {
        const k = rand(s.length);
        s = s.slice(0, k) + ENCODERS[rand(ENCODERS.length)](s[k]) + s.slice(k + 1);
      } else {
        const i = rand(s.length);
        const len = 1 + rand(Math.min(4, s.length - i));
        s = s.slice(0, i) + WRAPPERS[rand(WRAPPERS.length)](s.slice(i, i + len)) + s.slice(i + len);
      }
    }
    const [pre, post] = CONTEXTS[rand(CONTEXTS.length)];
    yield pre + s + post;
  }
}

test('D-6 generative: no unbroken scheme:// and no www. host with a live dot survives stripMarkup or safeField', (t) => {
  let cases = 0;
  const failures = [];
  for (const input of generatedCases()) {
    cases++;
    for (const [fn, out] of [['stripMarkup', stripMarkup(input)], ['safeField', safeField(input, 1500)]]) {
      const leaks = urlLeaks(out);
      if (leaks.length) failures.push(`${fn}(${JSON.stringify(input)}) = ${JSON.stringify(out)}: ${leaks.join(', ')}`);
    }
  }
  t.diagnostic(`generated cases: ${cases}`);
  assert.ok(cases > 10000, `fixture error: only ${cases} cases generated`);
  assert.equal(failures.length, 0, `${failures.length} leaks, first 10:\n${failures.slice(0, 10).join('\n')}`);
});

test('D-6 generative: the leak detector flags each form it exists to catch', () => {
  assert.deepEqual(urlLeaks('hxxps://evil[.]example ftp[:]//a[.]b xhxxps://c www[.]d[.]e'), []);
  assert.deepEqual(urlLeaks('http://a'), ['unbroken "http://"']);
  assert.deepEqual(urlLeaks('xhttps://a'), ['unbroken "xhttps://"']);
  assert.deepEqual(urlLeaks('hxxpsx://a'), ['unbroken "hxxpsx://"']);
  assert.deepEqual(urlLeaks('www.a'), ['www. with a live dot']);
  assert.deepEqual(urlLeaks('www[.]a.b'), ['www[.] host with a live dot']);
});
