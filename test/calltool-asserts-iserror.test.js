import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * D-12 bug class: a negative assertion that a failure also satisfies. An
 * error result carries no url, no token and no payload, so a test that calls
 * a tool and asserts only absences passes when the tool fails outright.
 * Every test that calls `callTool` must therefore assert on `isError`, either
 * that the call succeeded or that it failed as expected.
 *
 * A regex over top-level blocks, not an AST parse. A block starts at any
 * column-0 `test(`, `for`, `describe(`, `function`, `const`, `let` or `var`
 * and runs to the next one, so a helper that calls `callTool` is checked on
 * its own and a test that only calls the helper is not.
 */

const __filename = fileURLToPath(import.meta.url);
const TEST_ROOT = path.dirname(__filename);
const SELF_BASENAME = path.basename(__filename);

// Assembled by concatenation so this file never contains the idioms it
// hunts for, alongside excluding it from the scan.
const CALL = 'call' + 'Tool(';
const IS_ERROR = 'is' + 'Error';

const BLOCK_START = /^(?:test\(|for\b|describe\(|(?:async\s+)?function\b|const\b|let\b|var\b)/;
const IS_ERROR_ASSERTION = new RegExp(
  'assert(?:\\.\\w+)?\\(\\s*!?\\s*[\\w$.?\\[\\]]*\\.' + IS_ERROR + '\\b'
);

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function findUnassertedCallToolBlocks(source) {
  const lines = source.split('\n');
  const blocks = [];
  let current = null;
  lines.forEach((line, i) => {
    if (BLOCK_START.test(line)) {
      if (current) blocks.push(current);
      current = { line: i + 1, header: line.trim(), text: '' };
    }
    if (current) current.text += line + '\n';
  });
  if (current) blocks.push(current);

  return blocks.filter((b) => b.text.includes(CALL) && !IS_ERROR_ASSERTION.test(b.text));
}

function offensesIn(relPath, source) {
  return findUnassertedCallToolBlocks(source).map(
    ({ line, header }) => `  ${relPath}:${line}  ${header}`
  );
}

test('D-12: the check flags a planted absence-only callTool test and passes an asserting one', () => {
  const planted = [
    "import { test } from 'node:test';",
    "test('planted: absence only', async () => {",
    `  const res = await client.${CALL}{ name: 'find-tasks', arguments: {} });`,
    "  assert.ok(!res.content[0].text.includes('secret'));",
    '});',
    "test('planted: asserts success first', async () => {",
    `  const res = await client.${CALL}{ name: 'find-tasks', arguments: {} });`,
    `  assert.ok(!res.${IS_ERROR});`,
    "  assert.ok(!res.content[0].text.includes('secret'));",
    '});',
    "test('planted: asserts the expected error', async () => {",
    `  const res = await client.${CALL}{ name: 'find-tasks', arguments: {} });`,
    `  assert.equal(res.${IS_ERROR}, true);`,
    '});',
  ].join('\n');
  assert.deepEqual(offensesIn('planted.test.js', planted), [
    "  planted.test.js:2  test('planted: absence only', async () => {",
  ]);
});

test('D-12: every test in test/ that calls callTool asserts on isError', () => {
  const offenses = listJsFiles(TEST_ROOT)
    .filter((file) => path.basename(file) !== SELF_BASENAME)
    .flatMap((file) => offensesIn(path.relative(TEST_ROOT, file), fs.readFileSync(file, 'utf8')));
  assert.equal(
    offenses.length,
    0,
    'These blocks call a tool and never assert on isError, so an error result ' +
      'satisfies any absence they check (D-12):\n' +
      offenses.join('\n')
  );
});
