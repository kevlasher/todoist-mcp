import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/client.js';

/**
 * R17 (docs/SPEC.md section 7), fixed alongside D-1 in Session 10.
 *
 * The cursor path is correct and must not change: exactly-cap items with a
 * null cursor are complete, with a non-null cursor they are truncated.
 * The bare-array fallback breaks with no cursor and so always reported
 * not-truncated; it must report truncated when the array filled the page
 * limit it was asked for.
 *
 * Fixture values avoid 200 (TODOIST_MAX_ITEMS default and the API page size)
 * per SPEC section 8: maxItems is 37 and the explicit cap is 7.
 */

const cfg = { apiKey: 'r17-test-token-000000', maxItems: 37, maxFieldChars: 1500, maxOutputChars: 123457 };
const CAP = 7;
const ids = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i) }));

async function paginate(pages, cap = CAP) {
  const orig = globalThis.fetch;
  const limits = [];
  let call = 0;
  globalThis.fetch = async (url) => {
    limits.push(Number(new URL(url).searchParams.get('limit')));
    const page = pages[call++] ?? { results: [], next_cursor: null };
    return { ok: true, status: 200, text: async () => JSON.stringify(page) };
  };
  try {
    const out = await createClient(cfg).getPaginated('/tasks', {}, cap);
    return { ...out, limits };
  } finally {
    globalThis.fetch = orig;
  }
}

// ---- 10. bare-array fallback ---------------------------------------------

test('R17: a bare array that fills the page limit reports truncated', async () => {
  const { items, truncated, limits } = await paginate([ids(CAP)]);
  assert.equal(limits[0], CAP, 'fixture error: page limit was not the cap');
  assert.equal(items.length, CAP);
  assert.equal(truncated, true);
});

test('R17: a bare array longer than the page limit reports truncated and is sliced', async () => {
  const { items, truncated } = await paginate([ids(CAP + 2)]);
  assert.equal(items.length, CAP);
  assert.equal(truncated, true);
});

test('R17: a bare array shorter than the page limit reports not truncated', async () => {
  const { items, truncated } = await paginate([ids(CAP - 1)]);
  assert.equal(items.length, CAP - 1);
  assert.equal(truncated, false);
});

// ---- 11. cursor path, exact-cap boundary ---------------------------------

test('R17: exactly cap items with a null cursor is not truncated', async () => {
  const { items, truncated } = await paginate([{ results: ids(CAP), next_cursor: null }]);
  assert.equal(items.length, CAP);
  assert.equal(truncated, false);
});

test('R17: exactly cap items with a cursor still present is truncated', async () => {
  const { items, truncated } = await paginate([{ results: ids(CAP), next_cursor: 'more' }]);
  assert.equal(items.length, CAP);
  assert.equal(truncated, true);
});
