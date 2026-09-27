import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_ROOT = __dirname;
const SELF_BASENAME = path.basename(__filename);

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// The forbidden idiom is a positive `.includes(...)` call against one of the
// untrusted-value fence markers exported from src/sanitize.js. Both the call
// syntax and the marker names are assembled by concatenation, so the exact
// idiom text this test hunts for never appears contiguously in this file,
// belt and braces alongside excluding this filename from the scan below, so
// this test cannot flag itself even if one of the two safeguards slips.
const MARKER_OPEN_NAME = 'FRAME' + '_OPEN';
const MARKER_CLOSE_NAME = 'FRAME' + '_CLOSE';
const DOT_INCLUDES_OPEN_PAREN = '.' + 'includes' + '(';

function findPositiveIncludesSites(source) {
  const pattern = new RegExp(
    '(!\\s*)?[\\w$][\\w$.\\[\\]\'"]*' +
      DOT_INCLUDES_OPEN_PAREN.replace('.', '\\.').replace('(', '\\(') +
      '\\s*(' +
      MARKER_OPEN_NAME +
      '|' +
      MARKER_CLOSE_NAME +
      ')\\s*\\)',
    'g'
  );
  const sites = [];
  let m;
  while ((m = pattern.exec(source))) {
    const negated = Boolean(m[1]);
    if (negated) continue;
    const line = source.slice(0, m.index).split('\n').length;
    sites.push({ line, snippet: m[0].trim() });
  }
  return sites;
}

test('no positive .includes() check against the untrusted-value fence markers appears in test/', () => {
  const files = listJsFiles(TEST_ROOT).filter(
    (f) => path.basename(f) !== SELF_BASENAME
  );

  const offenses = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const site of findPositiveIncludesSites(source)) {
      offenses.push(`  ${path.relative(TEST_ROOT, file)}:${site.line}  ${site.snippet}`);
    }
  }

  const explanation =
    "UNTRUSTED_NOTICE (src/sanitize.js) contains both fence-marker strings in its own " +
    'explanatory text, and buildResult (src/result.js) prepends that notice to every ' +
    'successful tool response. A plain, non-negated presence check for a marker against a ' +
    'full tool result is therefore satisfied by the notice alone, regardless of whether any ' +
    'payload field was actually framed, so it proves nothing. Assert on the specific field ' +
    '(e.g. startsWith/endsWith/a length-based slice), or negate the check, instead.';

  assert.equal(
    offenses.length,
    0,
    `Found unconditionally-true framing assertion(s) in test/. ${explanation}\n${offenses.join('\n')}`
  );
});
