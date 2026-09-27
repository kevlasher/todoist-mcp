/**
 * The server announces the version in package.json.
 *
 * Found in Session 21: package.json and server.json say 0.1.0, but
 * src/server.js passed the literal '1.0.0' to McpServer, so every MCP client
 * was told 1.0.0 at initialization.
 *
 * The first test reads the version the way a client receives it: it spawns
 * the real stdio entry point (src/index.js) and reads the serverInfo the
 * server returns during initialization.
 *
 * Bug class: a version for this server declared somewhere other than
 * package.json. The static test fails on any `version:` key given a string
 * literal in src/, and on a server.json or package-lock.json whose version
 * differs from package.json. server.json is a separate document the MCP
 * Registry reads, and npm writes the lockfile's copy, so each carries its own;
 * the checks keep the copies equal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = join(ROOT, 'src');
const ENTRY = join(SRC, 'index.js');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** Every `version:` key given a string literal in `source`, as file:line: text. */
function versionLiterals(source, file) {
  const found = [];
  source.split('\n').forEach((line, i) => {
    if (/\bversion\s*:\s*['"`]/.test(line)) found.push(`${file}:${i + 1}: ${line.trim()}`);
  });
  return found;
}

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return jsFiles(p);
    return p.endsWith('.js') ? [p] : [];
  });
}

test('the server announces the package.json version over stdio', async () => {
  const client = new Client({ name: 'version-test', version: '0.0.1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [ENTRY],
      env: { PATH: process.env.PATH, TODOIST_API_KEY: 'version-dummy-token-not-real' },
      stderr: 'ignore',
    })
  );
  try {
    const info = client.getServerVersion();
    assert.equal(info.name, PKG.name);
    assert.equal(info.version, PKG.version);
  } finally {
    await client.close();
  }
});

test('no version literal in src/', () => {
  const literals = jsFiles(SRC).flatMap((file) =>
    versionLiterals(readFileSync(file, 'utf8'), relative(ROOT, file))
  );
  assert.deepEqual(literals, [], 'a version literal in src/ can drift from package.json');
});

test('the version-literal check flags a planted literal and passes a read from package.json', () => {
  const planted = "const s = new McpServer({\n  name: PKG.name,\n  version: '9.9.9',\n});";
  assert.deepEqual(versionLiterals(planted, 'planted.js'), ["planted.js:3: version: '9.9.9',"]);
  assert.deepEqual(versionLiterals('  version: PKG.version,', 'sound.js'), []);
});

test('server.json version equals package.json', () => {
  const serverJson = JSON.parse(readFileSync(join(ROOT, 'server.json'), 'utf8'));
  assert.equal(serverJson.version, PKG.version, 'server.json version must equal package.json');
});

test('package-lock.json root version equals package.json', () => {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, PKG.version, 'package-lock.json version must equal package.json');
  assert.equal(lock.packages[''].version, PKG.version, 'lockfile root package version');
});
