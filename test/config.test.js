import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnly, loadConfig } from '../src/config.js';

test('token can be sourced from a file via TODOIST_API_KEY_FILE', () => {
  const deps = { readFileSync: (p) => (p === '/secret/tok' ? '  file-token-123\n' : (() => { throw new Error('nope'); })()) };
  const cfg = loadConfig({ TODOIST_API_KEY_FILE: '/secret/tok' }, deps);
  assert.equal(cfg.apiKey, 'file-token-123');
});

test('direct TODOIST_API_KEY takes priority over the file', () => {
  const deps = { readFileSync: () => 'file-token' };
  const cfg = loadConfig({ TODOIST_API_KEY: 'direct-token', TODOIST_API_KEY_FILE: '/x' }, deps);
  assert.equal(cfg.apiKey, 'direct-token');
});

test('an unreadable key file surfaces a config error without leaking the path contents', () => {
  const deps = { readFileSync: () => { throw new Error('EACCES: permission denied, open /secret/tok'); } };
  assert.throws(
    () => loadConfig({ TODOIST_API_KEY_FILE: '/secret/tok' }, deps),
    /TODOIST_API_KEY_FILE could not be read/
  );
});

test('read-only default is fail-safe: unset => read-only', () => {
  assert.equal(isReadOnly({}), true);
  assert.equal(isReadOnly({ TODOIST_READONLY: '' }), true);
});

test('only the exact string "false" enables writes', () => {
  assert.equal(isReadOnly({ TODOIST_READONLY: 'false' }), false);
  assert.equal(isReadOnly({ TODOIST_READONLY: 'true' }), true);
  assert.equal(isReadOnly({ TODOIST_READONLY: '0' }), true);
  assert.equal(isReadOnly({ TODOIST_READONLY: 'FALSE' }), true);
  assert.equal(isReadOnly({ TODOIST_READONLY: 'no' }), true);
});

test('loadConfig throws without a token and never echoes it', () => {
  assert.throws(() => loadConfig({}), /TODOIST_API_KEY is not set/);
});

test('loadConfig parses caps with sane defaults', () => {
  const cfg = loadConfig({ TODOIST_API_KEY: 'abc123', TODOIST_MAX_ITEMS: 'not-a-number' });
  assert.equal(cfg.readOnly, true);
  assert.equal(cfg.maxItems, 200); // falls back on bad input
  assert.equal(cfg.maxOutputChars, 50000);
  assert.equal(cfg.maxFieldChars, 2000);

  const cfg2 = loadConfig({
    TODOIST_API_KEY: 'abc123',
    TODOIST_READONLY: 'false',
    TODOIST_MAX_ITEMS: '10',
    TODOIST_MAX_OUTPUT_CHARS: '1000',
  });
  assert.equal(cfg2.readOnly, false);
  assert.equal(cfg2.maxItems, 10);
  assert.equal(cfg2.maxOutputChars, 1000);
});
