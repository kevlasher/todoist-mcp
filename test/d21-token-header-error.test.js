import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyContractTestAccount } from '../test-contract/account-guard.js';

/**
 * D-21, CodeQL alerts #4 and #5: a contract token containing CR or LF made
 * the account guard's fetch throw `Headers.append: "Bearer <token>" is an
 * invalid header value.`, and the live scripts printed that message, token
 * included.
 *
 * Decided: the guard refuses a token containing any character outside
 * printable ASCII (0x20 to 0x7E) with a fixed message, before any request;
 * and every fetch in test-contract/ and scripts/ goes through one helper
 * that rethrows any error with fixed text.
 *
 * fetch is stubbed here and in every child process, so no request leaves
 * the machine. The stub builds a Request first, which validates headers
 * exactly as fetch does, so the header error is the real one.
 */

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.join(path.dirname(__filename), '..');

// Distinctive text on both sides of the bad character, so a leak of either
// part is caught, including one that redaction cuts at the line break.
const HEAD = 'D21HEADtokenpart0123456789';
const TAIL = 'D21TAILtokenpart9876543210';
const ACCOUNT_ID = 'contract-account-21';

const BAD_TOKEN_MESSAGE =
  'TODOIST_CONTRACT_TEST_TOKEN contains a character outside printable ASCII; refusing to send it.';
const FETCH_FAILED_MESSAGE =
  'Request to Todoist failed before a response arrived; the error is withheld because it can contain the token.';

const BAD_CHARACTERS = {
  LF: '\n',
  CR: '\r',
  CRLF: '\r\n',
  TAB: '\t',
  DEL: '\x7f',
  'U+00E9': '\u00e9',
  'U+2028': '\u2028',
};

function leaks(text) {
  return text.includes(HEAD) || text.includes(TAIL);
}

function everythingIn(err) {
  return [String(err?.message), String(err?.stack), String(err?.cause?.message), String(err?.cause)].join('\n');
}

async function withGuardEnv(token, fetchStub, fn) {
  const saved = {
    token: process.env.TODOIST_CONTRACT_TEST_TOKEN,
    id: process.env.TODOIST_CONTRACT_TEST_ACCOUNT_ID,
    fetch: globalThis.fetch,
  };
  process.env.TODOIST_CONTRACT_TEST_TOKEN = token;
  process.env.TODOIST_CONTRACT_TEST_ACCOUNT_ID = ACCOUNT_ID;
  globalThis.fetch = fetchStub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [k, v] of [
      ['TODOIST_CONTRACT_TEST_TOKEN', saved.token],
      ['TODOIST_CONTRACT_TEST_ACCOUNT_ID', saved.id],
    ]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

for (const [name, ch] of Object.entries(BAD_CHARACTERS)) {
  test(`D-21: the guard refuses a token containing ${name} with a fixed message and sends nothing`, async () => {
    const sent = [];
    const stub = async (input, init) => {
      new Request(input, init);
      sent.push(String(input));
      return new Response(JSON.stringify({ id: ACCOUNT_ID }), { status: 200 });
    };
    const err = await withGuardEnv(`${HEAD}${ch}${TAIL}`, stub, () =>
      verifyContractTestAccount().then(
        () => null,
        (e) => e
      )
    );
    assert.ok(err instanceof Error, `the guard accepted a token containing ${name}`);
    assert.equal(err.message, BAD_TOKEN_MESSAGE);
    assert.equal(leaks(everythingIn(err)), false, 'the error carries part of the token');
    assert.deepEqual(sent, []);
  });
}

// NUL is not in the list above because it cannot reach the guard, which
// reads the token from process.env: an environment value ends at its first
// NUL, and spawn refuses one. The guard's check rejects NUL anyway.
test('D-21: a NUL cannot reach the guard through the environment', () => {
  const saved = process.env.TODOIST_CONTRACT_TEST_TOKEN;
  try {
    process.env.TODOIST_CONTRACT_TEST_TOKEN = `${HEAD}\0${TAIL}`;
    assert.equal(process.env.TODOIST_CONTRACT_TEST_TOKEN, HEAD);
  } finally {
    if (saved === undefined) delete process.env.TODOIST_CONTRACT_TEST_TOKEN;
    else process.env.TODOIST_CONTRACT_TEST_TOKEN = saved;
  }
  assert.throws(
    () => spawnSync(process.execPath, ['-e', ''], { env: { X: `${HEAD}\0${TAIL}` } }),
    { code: 'ERR_INVALID_ARG_VALUE' }
  );
});

test('D-21: the guard still accepts a printable-ASCII token and checks the account', async () => {
  const sent = [];
  const stub = async (input, init) => {
    const req = new Request(input, init);
    sent.push(req.headers.get('authorization'));
    return new Response(JSON.stringify({ id: ACCOUNT_ID, email: 'x@example.invalid' }), { status: 200 });
  };
  const token = `${HEAD} !~${TAIL}`;
  const account = await withGuardEnv(token, stub, () => verifyContractTestAccount());
  assert.deepEqual(account, { id: ACCOUNT_ID, email: 'x@example.invalid' });
  assert.deepEqual(sent, [`Bearer ${token}`]);
});

test('D-21: an error thrown by the guard\'s fetch is rethrown with fixed text', async () => {
  const token = `${HEAD}${TAIL}`;
  const stub = async () => {
    const e = new Error(`socket closed while sending Bearer ${token}`);
    e.cause = new Error(`cause also carries ${token}`);
    throw e;
  };
  const err = await withGuardEnv(token, stub, () =>
    verifyContractTestAccount().then(
      () => null,
      (e) => e
    )
  );
  assert.ok(err instanceof Error, 'the guard did not fail');
  assert.equal(err.message, FETCH_FAILED_MESSAGE);
  assert.equal(err.cause, undefined);
  assert.equal(leaks(everythingIn(err)), false, 'the error carries part of the token');
});

// ---- the live scripts, run as child processes with fetch stubbed ---------

const STUB_SOURCE = `
import fs from 'node:fs';
globalThis.fetch = async (input, init = {}) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  fs.appendFileSync(process.env.STUB_FETCH_LOG, req.method + ' ' + url.pathname + '\\n');
  if (url.pathname === '/api/v1/user') {
    return new Response(JSON.stringify({ id: process.env.STUB_USER_ID }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  throw new Error('connection reset while sending ' + req.headers.get('authorization'));
};
`;

const SCRIPTS = [
  'scripts/live-smoke.js',
  'scripts/live-smoke-date.js',
  'test-contract/update-task-partial.contract.js',
];

function runScript(rel, token) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd21-'));
  const stub = path.join(dir, 'fetch-stub.mjs');
  const log = path.join(dir, 'requests.log');
  fs.writeFileSync(stub, STUB_SOURCE);
  fs.writeFileSync(log, '');
  // The child writes its coverage into the temporary directory, which is
  // deleted below, so section 8's figures stay src/ and test/ only.
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('TODOIST_')) env[k] = v;
  }
  Object.assign(env, {
    STUB_FETCH_LOG: log,
    STUB_USER_ID: ACCOUNT_ID,
    TODOIST_CONTRACT_TEST_TOKEN: token,
    TODOIST_CONTRACT_TEST_ACCOUNT_ID: ACCOUNT_ID,
    TODOIST_READONLY: 'false',
    NODE_V8_COVERAGE: path.join(dir, 'coverage'),
  });
  const result = spawnSync(process.execPath, ['--import', stub, path.join(REPO_ROOT, rel)], {
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
  const requests = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}`, requests };
}

for (const rel of SCRIPTS) {
  test(`D-21: ${rel} with a token containing LF prints no part of it and sends nothing`, () => {
    const { status, output, requests } = runScript(rel, `${HEAD}\n${TAIL}`);
    assert.notEqual(status, 0, output);
    assert.ok(output.includes(BAD_TOKEN_MESSAGE), output);
    assert.equal(leaks(output), false, `the output carries part of the token:\n${output}`);
    assert.deepEqual(requests, []);
  });
}

test('D-21: the contract test prints no part of the token when a task request throws', () => {
  const rel = 'test-contract/update-task-partial.contract.js';
  const { status, output, requests } = runScript(rel, `${HEAD}${TAIL}`);
  assert.notEqual(status, 0, output);
  assert.deepEqual(requests, ['GET /api/v1/user', 'POST /api/v1/tasks']);
  assert.ok(output.includes(FETCH_FAILED_MESSAGE), output);
  assert.equal(leaks(output), false, `the output carries part of the token:\n${output}`);
});

// ---- static check for the bug class ---------------------------------------

/**
 * Bug class: a request in test-contract/ or scripts/ whose error can reach
 * a message or the console carrying the token. Every request there must go
 * through the one helper, defined once in test-contract/account-guard.js,
 * whose body sends the request inside a try and, in a catch that binds no
 * error, throws an Error with a fixed string literal.
 *
 * Textual, not an AST parse. With comments removed, it fails on any call of
 * fetch (bare, as `globalThis.fetch(`, or through .call, .apply or .bind),
 * on any call of a name assigned from fetch, and on the helper defined
 * anywhere else, more than once, or with any other body. Every fetch counts,
 * not only those that send the token: whether one does depends on the
 * headers it is given, which a textual check cannot follow.
 */

// Assembled by concatenation so this file never contains the idioms it
// hunts for.
const HELPER = 'fetchWith' + 'FixedError';
const HELPER_HOME = 'test-contract/account-guard.js';

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

function lineOf(code, index) {
  return code.slice(0, index).split('\n').length;
}

function helperDefinitions(code) {
  const out = [];
  const re = new RegExp(`function\\s+${HELPER}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(code))) {
    const open = code.indexOf('{', code.indexOf(')', m.index));
    let depth = 0;
    let close = -1;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}' && --depth === 0) {
        close = i;
        break;
      }
    }
    out.push({ at: m.index, from: open, to: close === -1 ? code.length : close + 1 });
  }
  return out;
}

const HELPER_BODY =
  /^\{\s*try\s*\{\s*return\s+await\s+[A-Za-z_$][\w$]*\([^;{}]*\);?\s*\}\s*catch\s*\{\s*throw\s+new\s+Error\(\s*'[^'\\]*'\s*\);?\s*\}\s*\}$/;

function fetchViolations(files) {
  const out = [];
  const homes = [];
  for (const [rel, source] of files) {
    const code = stripComments(source);
    const defs = helperDefinitions(code);
    for (const d of defs) {
      homes.push(`${rel}:${lineOf(code, d.at)}`);
      if (rel !== HELPER_HOME) {
        out.push(`${rel}:${lineOf(code, d.at)}: defines ${HELPER} outside ${HELPER_HOME}`);
      }
      if (!HELPER_BODY.test(code.slice(d.from, d.to))) {
        out.push(`${rel}:${lineOf(code, d.at)}: ${HELPER} does not rethrow every error with a fixed string`);
      }
    }
    const inHelper = (i) => defs.some((d) => i >= d.from && i < d.to);

    const aliases = [];
    const aliasRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:globalThis\.|global\.|self\.)?fetch\b(?!\s*\()/g;
    let m;
    while ((m = aliasRe.exec(code))) aliases.push(m[1]);
    const callees = ['fetch', ...aliases].map((n) => n.replace(/\$/g, '\\$')).join('|');
    const callRe = new RegExp(`(?<![\\w$])(${callees})\\s*(?:\\.\\s*(?:call|apply|bind)\\s*)?\\(`, 'g');
    while ((m = callRe.exec(code))) {
      if (inHelper(m.index)) continue;
      out.push(`${rel}:${lineOf(code, m.index)}: calls ${m[1]}( outside ${HELPER}`);
    }
  }
  if (homes.length > 1) out.push(`${HELPER} is defined ${homes.length} times: ${homes.join(', ')}`);
  return out;
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

test('D-21 class check: flags every unwrapped fetch and every helper that can pass an error on', () => {
  const good = [
    `export async function ${HELPER}(url, init, send = fetch) {`,
    '  try {',
    '    return await send(url, init);',
    '  } catch {',
    "    throw new Error('fixed text');",
    '  }',
    '}',
  ].join('\n');
  const planted = [
    [HELPER_HOME, good],
    ['scripts/ok.js', `// fetch( in a comment does not count\nconst real = globalThis.fetch;\nawait ${HELPER}(u, o, real);`],
    ['scripts/direct.js', 'await fetch(u, o);'],
    ['scripts/global.js', 'await globalThis.fetch(u, o);'],
    ['scripts/alias.js', 'const realFetch = globalThis.fetch;\nawait realFetch(u, o);'],
    ['scripts/call.js', 'await fetch.call(null, u, o);'],
    ['scripts/binding.js', good.replace('catch {', 'catch (err) {').replace("'fixed text'", 'err.message')],
    ['scripts/template.js', good.replace("'fixed text'", '`failed: ${u}`')],
    ['scripts/rethrow.js', good.replace("throw new Error('fixed text');", 'throw 1;')],
  ];
  assert.deepEqual(fetchViolations(planted), [
    'scripts/direct.js:1: calls fetch( outside ' + HELPER,
    'scripts/global.js:1: calls fetch( outside ' + HELPER,
    'scripts/alias.js:2: calls realFetch( outside ' + HELPER,
    'scripts/call.js:1: calls fetch( outside ' + HELPER,
    `scripts/binding.js:1: defines ${HELPER} outside ${HELPER_HOME}`,
    `scripts/binding.js:1: ${HELPER} does not rethrow every error with a fixed string`,
    `scripts/template.js:1: defines ${HELPER} outside ${HELPER_HOME}`,
    `scripts/template.js:1: ${HELPER} does not rethrow every error with a fixed string`,
    `scripts/rethrow.js:1: defines ${HELPER} outside ${HELPER_HOME}`,
    `scripts/rethrow.js:1: ${HELPER} does not rethrow every error with a fixed string`,
    `${HELPER} is defined 4 times: ${HELPER_HOME}:1, scripts/binding.js:1, scripts/template.js:1, scripts/rethrow.js:1`,
  ]);
});

test('D-21 class: every request in test-contract/ and scripts/ rethrows its errors with fixed text', () => {
  const files = ['test-contract', 'scripts']
    .flatMap((d) => listJsFiles(path.join(REPO_ROOT, d)))
    .map((f) => [path.relative(REPO_ROOT, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')]);
  assert.ok(files.some(([rel]) => rel === HELPER_HOME), `fixture error: ${HELPER_HOME} not found`);
  const violations = fetchViolations(files);
  const defined = files.some(([rel, src]) => rel === HELPER_HOME && helperDefinitions(stripComments(src)).length === 1);
  if (!defined) violations.push(`${HELPER} is not defined in ${HELPER_HOME}`);
  assert.deepEqual(violations, []);
});
