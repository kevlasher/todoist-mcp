import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * D-11 bug class: code outside test/ that can write to a live Todoist account
 * without first proving which account its token opens. Every file in scripts/
 * or test-contract/ that can send a non-GET request must call
 * verifyContractTestAccount before anything that can reach Todoist.
 *
 * A file can send a non-GET request if it names a non-GET HTTP method, calls
 * a tool through an MCP client, or imports the server, the HTTP client or the
 * tool handlers from src/. The account guard itself sends only GET and is not
 * such a file.
 *
 * A textual check, not an AST parse. With comments removed, the first call to
 * the guard must come before the first call to fetch, loadConfig,
 * createServer or callTool.
 */

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.join(path.dirname(__filename), '..');
const LIVE_DIRS = ['scripts', 'test-contract'];

// Assembled by concatenation so this file never contains the idioms it
// hunts for.
const GUARD_CALL = 'verifyContract' + 'TestAccount(';
const REQUEST_CALLS = ['fetch(', 'load' + 'Config(', 'create' + 'Server(', 'call' + 'Tool('];

const WRITE_CAPABLE = [
  /method:\s*['"`](?:POST|PUT|PATCH|DELETE)['"`]/,
  /\.callTool\(/,
  /from\s+['"][./]*src\/(?:server|client)\.js['"]/,
  /from\s+['"][./]*src\/tools\//,
];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

function firstIndex(code, needle) {
  const i = code.indexOf(needle);
  return i === -1 ? Infinity : i;
}

function offenseIn(relPath, source) {
  const code = stripComments(source);
  if (!WRITE_CAPABLE.some((re) => re.test(code))) return null;
  const guardAt = firstIndex(code, GUARD_CALL);
  const firstRequest = REQUEST_CALLS.map((c) => [c, firstIndex(code, c)]).sort((a, b) => a[1] - b[1])[0];
  if (guardAt === Infinity) return `  ${relPath}: never calls the account guard`;
  if (guardAt > firstRequest[1]) {
    return `  ${relPath}: calls ${firstRequest[0]} before the account guard`;
  }
  return null;
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

test('D-11: the check flags unguarded and late-guarded writers and passes a guarded one', () => {
  const planted = {
    'unguarded.js': [
      "import { createServer } from '../src/server.js';",
      `const s = create${'Server('}cfg);`,
    ].join('\n'),
    'late-guard.js': [
      "await fetch(url, { method: 'POST' });",
      `await ${GUARD_CALL});`,
    ].join('\n'),
    'guarded.js': [
      '// fetch( in a comment does not count',
      `await ${GUARD_CALL});`,
      "await fetch(url, { method: 'DELETE' });",
    ].join('\n'),
    'read-only.js': "await fetch(url, { method: 'GET' });",
  };
  const offenses = Object.entries(planted)
    .map(([name, src]) => offenseIn(name, src))
    .filter(Boolean);
  assert.deepEqual(offenses, [
    '  unguarded.js: never calls the account guard',
    '  late-guard.js: calls fetch( before the account guard',
  ]);
});

test('D-11: every file in scripts/ and test-contract/ that can write calls the account guard first', () => {
  const files = LIVE_DIRS.flatMap((d) => listJsFiles(path.join(REPO_ROOT, d)));
  assert.ok(files.length > 0, 'no files found to scan');
  const offenses = files
    .map((file) => offenseIn(path.relative(REPO_ROOT, file), fs.readFileSync(file, 'utf8')))
    .filter(Boolean);
  assert.equal(
    offenses.length,
    0,
    'These files can send a non-GET request to Todoist without first verifying ' +
      'the contract test account (D-11):\n' +
      offenses.join('\n')
  );
});
