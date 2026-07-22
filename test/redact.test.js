import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerSecret, redact, redactError } from '../src/redact.js';

const TOKEN = 'a1b2c3d4e5f6secrettoken0987654321';
registerSecret(TOKEN);

test('registered token is scrubbed from arbitrary strings', () => {
  const out = redact(`request failed with token=${TOKEN} in url`);
  assert.ok(!out.includes(TOKEN));
  assert.ok(out.includes('[REDACTED]'));
});

test('Bearer material is redacted even if not registered', () => {
  const out = redact('Authorization: Bearer zzz.unregistered.value123');
  assert.ok(!out.includes('zzz.unregistered.value123'), 'raw bearer value must be gone');
  assert.ok(out.includes('[REDACTED]'), 'redaction marker present');
});

test('authorization header value is redacted regardless of format', () => {
  const out = redact('{"authorization":"someheadervalue"}');
  assert.ok(!out.includes('someheadervalue'));
});

test('redactError scrubs message and stack', () => {
  const err = new Error(`boom with ${TOKEN}`);
  const red = redactError(err);
  assert.ok(!red.message.includes(TOKEN));
  assert.ok(!(red.stack ?? '').includes(TOKEN));
});
