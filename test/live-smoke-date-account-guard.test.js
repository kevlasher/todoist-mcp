import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * D-11: scripts/live-smoke-date.js must not write to whatever account its
 * token opens. It runs here as a child process with globalThis.fetch replaced
 * before the script loads, so no request leaves the machine. The stub records
 * every request and answers GET /user with the id this test chooses.
 *
 * The stub is written to a temporary directory rather than kept under test/,
 * so `npm test` never collects it as a test file.
 */

const __filename = fileURLToPath(import.meta.url);
const SCRIPT = path.join(path.dirname(__filename), '..', 'scripts', 'live-smoke-date.js');
const USER_URL = 'https://api.todoist.com/api/v1/user';

const CONTRACT_TOKEN = 'contract-token-stub-111';
const PERSONAL_TOKEN = 'personal-token-stub-222';
const FILE_TOKEN = 'file-token-stub-333';
const ACCOUNT_ID = 'contract-account-9001';

const STUB_SOURCE = `
import fs from 'node:fs';
globalThis.fetch = async (input, opts = {}) => {
  const url = String(input);
  const auth = new Headers(opts.headers ?? {}).get('authorization');
  fs.appendFileSync(
    process.env.STUB_FETCH_LOG,
    JSON.stringify({ method: opts.method ?? 'GET', url, auth }) + '\\n'
  );
  const body = new URL(url).pathname === '/api/v1/user'
    ? { id: process.env.STUB_USER_ID, email: 'stub@example.invalid' }
    : {};
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
`;

function runScript(extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd11-'));
  const stub = path.join(dir, 'fetch-stub.mjs');
  const log = path.join(dir, 'requests.jsonl');
  const keyFile = path.join(dir, 'key');
  fs.writeFileSync(stub, STUB_SOURCE);
  fs.writeFileSync(log, '');
  fs.writeFileSync(keyFile, FILE_TOKEN);

  // The child writes its coverage into the temporary directory, which is
  // deleted below, so it is not merged into the suite's figures: section 8's
  // baselines measure src/ and test/ only. Deleting NODE_V8_COVERAGE is not
  // enough, because child_process copies it back into a child's environment.
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('TODOIST_')) env[k] = v;
  }
  Object.assign(env, {
    STUB_FETCH_LOG: log,
    TODOIST_READONLY: 'false',
    NODE_V8_COVERAGE: path.join(dir, 'coverage'),
  });
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete env[k];
    else env[k] = v === '<keyfile>' ? keyFile : v;
  }

  const result = spawnSync(process.execPath, ['--import', stub, SCRIPT], {
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
  const requests = fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: result.status, requests };
}

test('D-11: with the contract variables unset, live-smoke-date.js exits non-zero and makes no request', () => {
  const { status, requests } = runScript({
    TODOIST_API_KEY: PERSONAL_TOKEN,
    TODOIST_API_KEY_FILE: '<keyfile>',
    TODOIST_CONTRACT_TEST_TOKEN: undefined,
    TODOIST_CONTRACT_TEST_ACCOUNT_ID: undefined,
  });
  assert.deepEqual(requests, [], 'no request may be sent without the contract variables');
  assert.notEqual(status, 0);
});

test('D-11: on an account id mismatch, the only request is the account check and the script exits non-zero', () => {
  const { status, requests } = runScript({
    TODOIST_API_KEY: PERSONAL_TOKEN,
    TODOIST_API_KEY_FILE: '<keyfile>',
    TODOIST_CONTRACT_TEST_TOKEN: CONTRACT_TOKEN,
    TODOIST_CONTRACT_TEST_ACCOUNT_ID: ACCOUNT_ID,
    STUB_USER_ID: 'some-other-account-42',
  });
  assert.deepEqual(requests, [
    { method: 'GET', url: USER_URL, auth: `Bearer ${CONTRACT_TOKEN}` },
  ]);
  assert.notEqual(status, 0);
});

test('D-11: on a verified account, the account check comes first and every request uses only the contract token', () => {
  const { requests } = runScript({
    TODOIST_API_KEY: PERSONAL_TOKEN,
    TODOIST_API_KEY_FILE: '<keyfile>',
    TODOIST_CONTRACT_TEST_TOKEN: CONTRACT_TOKEN,
    TODOIST_CONTRACT_TEST_ACCOUNT_ID: ACCOUNT_ID,
    STUB_USER_ID: ACCOUNT_ID,
  });
  assert.deepEqual(requests[0], { method: 'GET', url: USER_URL, auth: `Bearer ${CONTRACT_TOKEN}` });
  assert.ok(requests.length > 1, 'the script should proceed past a verified account check');
  assert.deepEqual(
    requests.filter((r) => r.auth !== `Bearer ${CONTRACT_TOKEN}`),
    [],
    'every request must carry the verified contract token, never TODOIST_API_KEY or the key file'
  );
});
