import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripMarkup } from '../src/sanitize.js';

/**
 * D-25, CodeQL alert #3: decodeHtmlEntities decoded numeric entities in one
 * replace() and the named ones in later calls, so a numerically encoded `&`
 * was decoded twice: `&#38;lt;` became `&lt;` and then `<`, while
 * `&amp;lt;` became `&lt;` only. R10 says one decoding round; the fix is one
 * replace() with one pattern and a callback, so a scan never sees its own
 * output. Security-neutral: stripMarkup handles `<` and `[&]lt;` alike.
 * The same chain decoded `&amp;quot;` and `&amp;apos;` twice even in the
 * `&amp;` form, because `&amp;` ran before `&quot;` and `&apos;`.
 *
 * Each case pins the exact output, so the &#38; and &#x26; forms cannot
 * match the &amp; form by all three changing together.
 */

const CASES = [
  { name: 'lt', amp: '&amp;lt;', want: '[&]lt;' },
  { name: 'comment', amp: '&amp;lt;!-- x --&amp;gt;', want: '[&]lt;!-- x --[&]gt;' },
  { name: 'tag', amp: '&amp;lt;b&amp;gt;bold&amp;lt;/b&amp;gt;', want: '[&]lt;b[&]gt;bold[&]lt;/b[&]gt;' },
  { name: 'amp', amp: '&amp;amp;', want: '[&]amp;' },
  { name: 'quot', amp: 'say &amp;quot;hi&amp;quot;', want: 'say [&]quot;hi[&]quot;' },
  { name: 'apos', amp: 'it&amp;apos;s', want: 'it[&]apos;s' },
];

const NUMERIC_AMPS = ['&#38;', '&#038;', '&#x26;', '&#X26;', '&#x0026;'];

for (const { name, amp, want } of CASES) {
  test(`D-25: the &amp; form decodes one round (${name})`, () => {
    assert.equal(stripMarkup(amp), want);
  });
  for (const numeric of NUMERIC_AMPS) {
    const input = amp.split('&amp;').join(numeric);
    test(`D-25: ${JSON.stringify(input)} decodes like the &amp; form`, () => {
      assert.equal(stripMarkup(input), want);
    });
  }
}

test('D-25: a single round still decodes every entity it knows', () => {
  assert.equal(stripMarkup('a &#65;&#x42; &quot;q&quot; &apos;s&apos; &amp; z'), 'a AB "q" \'s\' & z');
  assert.equal(stripMarkup('x &lt;b&gt;y&lt;/b&gt; &#60;i&#62;w&#x3C;/i&#x3E;'), 'x y w');
  assert.equal(stripMarkup('&#x110000;'), '�');
});

// ---- static check for the bug class ---------------------------------------

/**
 * Bug class: a decoding pass that scans its own output. decodeHtmlEntities
 * must make exactly one replace() call, with no replaceAll(), and must not
 * call itself. stripMarkup must call it exactly once, outside untilStable,
 * and nothing else in src/ may call it, so text is decoded one round.
 *
 * Textual, not an AST parse. The function body is found by brace matching
 * from its opening brace, which a brace inside a string or regex literal in
 * that body would throw off; the check then fails rather than passes.
 */

const __filename = fileURLToPath(import.meta.url);
const SRC_ROOT = path.join(path.dirname(__filename), '..', 'src');
// Assembled by concatenation so this file never contains the idiom it hunts for.
const DECODER = 'decodeHtml' + 'Entities';

function bodyOf(src, name) {
  const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(src);
  if (!m) return null;
  const open = src.indexOf('{', src.indexOf(')', m.index));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return { from: open, to: i + 1, text: src.slice(open, i + 1) };
  }
  return { from: open, to: src.length, text: src.slice(open) };
}

function decodingViolations(files) {
  const out = [];
  let definitions = 0;
  for (const [rel, src] of files) {
    const body = bodyOf(src, DECODER);
    if (body) {
      definitions++;
      const replaces = body.text.match(/\breplace(?:All)?\b/g) ?? [];
      const calls = body.text.match(/\.replace\s*\(/g) ?? [];
      if (replaces.length !== 1 || calls.length !== 1) {
        out.push(`${rel}: ${DECODER} makes ${replaces.length} replace calls, not exactly one .replace(`);
      }
      if (new RegExp(`\\b${DECODER}\\s*\\(`).test(body.text)) {
        out.push(`${rel}: ${DECODER} calls itself`);
      }
    }
    const strip = bodyOf(src, 'stripMarkup');
    const callRe = new RegExp(`(?<!function\\s+)\\b${DECODER}\\s*\\(`, 'g');
    let m;
    let inStrip = 0;
    while ((m = callRe.exec(src))) {
      if (body && m.index >= body.from && m.index < body.to) continue;
      const line = src.slice(0, m.index).split('\n').length;
      if (!strip || m.index < strip.from || m.index >= strip.to) {
        out.push(`${rel}:${line}: ${DECODER} called outside stripMarkup`);
        continue;
      }
      inStrip++;
      const before = src.slice(strip.from, m.index);
      const openGroup = before.lastIndexOf('untilStable(');
      if (openGroup !== -1) {
        let depth = 0;
        for (const ch of before.slice(openGroup + 'untilStable'.length)) {
          if (ch === '(') depth++;
          else if (ch === ')') depth--;
        }
        if (depth > 0) out.push(`${rel}:${line}: ${DECODER} called inside untilStable`);
      }
    }
    if (strip && inStrip !== 1) out.push(`${rel}: stripMarkup calls ${DECODER} ${inStrip} times, not once`);
  }
  if (definitions !== 1) out.push(`${DECODER} is defined ${definitions} times, not once`);
  return out;
}

function srcFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(dir, f));
}

test('D-25 class check: flags a missing, chained, replace-free, self-calling or unterminated decoder, a repeated or looped call, and a stray caller', () => {
  const single = `function ${DECODER}(t) {\n  return t.replace(/&(amp|lt);/g, (m, n) => MAP[n]);\n}`;
  const chained = `function ${DECODER}(t) {\n  return t.replace(/&#(\\d+);/g, dec).replace(/&amp;/g, '&');\n}`;
  const all = `function ${DECODER}(t) {\n  return t.replaceAll('&amp;', '&');\n}`;
  const strip = (body) => `export function stripMarkup(input) {\n${body}\n}`;
  const once = `  let text = ${DECODER}(input);\n  return text;`;
  const planted = {
    good: [['sanitize.js', `${single}\n${strip(once)}`]],
    chained: [['sanitize.js', `${chained}\n${strip(once)}`]],
    replaceAll: [['sanitize.js', `${all}\n${strip(once)}`]],
    twice: [['sanitize.js', `${single}\n${strip(`  let text = ${DECODER}(input);\n  return ${DECODER}(text);`)}`]],
    looped: [['sanitize.js', `${single}\n${strip(`  return untilStable(input, (t) => ${DECODER}(t));`)}`]],
    stray: [
      ['sanitize.js', `${single}\n${strip(once)}`],
      ['shape.js', `export const f = (x) => ${DECODER}(x);`],
    ],
    recursive: [['sanitize.js', `${single.replace('MAP[n]', `${DECODER}(m)`)}\n${strip(once)}`]],
    unterminated: [['sanitize.js', `${strip(once)}\n${chained.slice(0, -2)}`]],
    none: [['sanitize.js', `function ${DECODER}(t) {\n  return t;\n}\n${strip(once)}`]],
    undefined: [['sanitize.js', strip(once)]],
  };
  const results = Object.fromEntries(Object.entries(planted).map(([k, v]) => [k, decodingViolations(v)]));
  assert.deepEqual(results, {
    good: [],
    chained: [`sanitize.js: ${DECODER} makes 2 replace calls, not exactly one .replace(`],
    replaceAll: [`sanitize.js: ${DECODER} makes 1 replace calls, not exactly one .replace(`],
    twice: ['sanitize.js: stripMarkup calls ' + DECODER + ' 2 times, not once'],
    looped: [`sanitize.js:5: ${DECODER} called inside untilStable`],
    stray: [`shape.js:1: ${DECODER} called outside stripMarkup`],
    recursive: [`sanitize.js: ${DECODER} calls itself`],
    unterminated: [`sanitize.js: ${DECODER} makes 2 replace calls, not exactly one .replace(`],
    none: [`sanitize.js: ${DECODER} makes 0 replace calls, not exactly one .replace(`],
    undefined: [`${DECODER} is defined 0 times, not once`],
  });
});

test('D-25 class: decodeHtmlEntities makes exactly one replace call and runs once per stripMarkup', () => {
  const files = srcFiles(SRC_ROOT).map((f) => [path.relative(SRC_ROOT, f), fs.readFileSync(f, 'utf8')]);
  assert.ok(files.some(([rel]) => rel === 'sanitize.js'), 'fixture error: src/sanitize.js not found');
  assert.deepEqual(decodingViolations(files), []);
});
