import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { UNTRUSTED_NOTICE } from '../src/sanitize.js';

/**
 * D-1 (docs/SPEC.md section 10), Session 10: get-overview must not present a
 * count derived from a truncated fetch as exact.
 *
 * Decisions this file tests:
 *   - The tasks fetch uses a fixed ceiling of 5000, independent of
 *     TODOIST_MAX_ITEMS. Tasks are only counted; no task text is returned.
 *   - Projects, sections and labels keep TODOIST_MAX_ITEMS, because their
 *     names are returned and are attacker-writable.
 *   - Every count is { count, is_floor }, and is_floor is true exactly when
 *     the fetch it derives from was truncated.
 *   - Per-fetch truncation is reported under `fetches`; `warnings` is present
 *     only when something was truncated; the unconditional `note` is gone.
 *   - Sections and tasks whose project is not in the projects fetch are
 *     surfaced as `unmatched_sections` and `tasks_in_unlisted_projects`.
 *   - Signal keys precede the large name lists, so capOutput cuts the lists
 *     first.
 *
 * Fixture values deliberately avoid 200 (TODOIST_MAX_ITEMS default and the
 * API page size) and 5000 (the tasks ceiling), per SPEC section 8: maxItems
 * is 37, and account sizes are 3/11/4/413 below the caps and 53/59/61/5173
 * above them. The only 5000 in this file is the literal the ceiling test
 * asserts against, written as a literal so changing the constant fails it.
 *
 * This file writes tests only; src/ is untouched.
 */

const MAX_ITEMS = 37;
const TASK_CEILING = 5000;

const serverCfg = {
  apiKey: 'd1-test-token-000000',
  readOnly: true,
  maxOutputChars: 123457,
  maxFieldChars: 1500,
  maxItems: MAX_ITEMS,
};

/** Build an account fixture. Counts are item totals held by the fake API. */
function account({ projects = 3, sections = 11, labels = 4, tasks = 413, extra = {} } = {}) {
  const P = Array.from({ length: projects }, (_, i) => ({
    id: `p${i}`,
    name: `Project ${i}`,
    is_inbox_project: i === 0,
  }));
  const S = Array.from({ length: sections }, (_, i) => ({
    id: `s${i}`,
    name: `Section ${i}`,
    project_id: `p${i % projects}`,
  }));
  const L = Array.from({ length: labels }, (_, i) => ({ id: `l${i}`, name: `label${i}` }));
  const T = Array.from({ length: tasks }, (_, i) => ({
    id: `t${i}`,
    content: `Task ${i}`,
    project_id: `p${i % projects}`,
    due: i % 5 === 0 ? { date: '2000-01-01' } : null,
  }));
  return {
    '/projects': [...P, ...(extra.projects ?? [])],
    '/sections': [...S, ...(extra.sections ?? [])],
    '/labels': [...L, ...(extra.labels ?? [])],
    '/tasks': [...T, ...(extra.tasks ?? [])],
  };
}

/**
 * Fake Todoist v1 list endpoints. Honours the requested `limit` and uses the
 * cursor as an offset, so page size is never hard-coded in a fixture.
 */
function fakeApi(data) {
  const requested = [];
  const fetch = async (url) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api\/v1/, '');
    const all = data[path];
    if (!all) throw new Error(`fixture error: unexpected path ${path}`);
    const limit = Number(u.searchParams.get('limit'));
    const offset = Number(u.searchParams.get('cursor') ?? 0);
    requested.push({ path, limit, offset });
    const results = all.slice(offset, offset + limit);
    const next = offset + results.length;
    const body = { results, next_cursor: next < all.length ? String(next) : null };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetch, requested };
}

async function overview(data) {
  const api = fakeApi(data);
  const orig = globalThis.fetch;
  globalThis.fetch = api.fetch;
  try {
    const { server } = createServer(serverCfg);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const res = await client.callTool({ name: 'get-overview', arguments: {} });
    await client.close();
    assert.ok(!res.isError, `get-overview returned an error: ${res.content?.[0]?.text}`);
    const text = res.content.map((c) => c.text).join('\n');
    const prefix = `${UNTRUSTED_NOTICE}\n\n`;
    assert.ok(text.startsWith(prefix), 'fixture error: result does not start with the notice');
    return { text, payload: JSON.parse(text.slice(prefix.length)), requested: api.requested };
  } finally {
    globalThis.fetch = orig;
  }
}

/** Assert a value is a count object with the expected floor flag. */
function assertCount(value, isFloor, where) {
  assert.equal(typeof value, 'object', `${where}: expected { count, is_floor }, got ${JSON.stringify(value)}`);
  assert.notEqual(value, null, `${where}: count object is null`);
  assert.equal(typeof value.count, 'number', `${where}: count is not a number: ${JSON.stringify(value)}`);
  assert.equal(value.is_floor, isFloor, `${where}: is_floor should be ${isFloor}, got ${JSON.stringify(value)}`);
}

/**
 * The D-1 guard: every count's is_floor equals the truncated flag of the
 * fetch it is derived from. A count from a truncated fetch presented as
 * exact fails here, and so does an exact count wrongly marked as a floor.
 */
function assertFloorsMatchFetches(payload) {
  const f = payload.fetches;
  assert.equal(typeof f, 'object', `no fetches block: ${JSON.stringify(Object.keys(payload))}`);
  for (const name of ['projects', 'sections', 'labels', 'tasks']) {
    assert.equal(typeof f[name]?.truncated, 'boolean', `fetches.${name}.truncated missing`);
    assert.equal(typeof f[name]?.fetched, 'number', `fetches.${name}.fetched missing`);
  }
  const t = payload.totals;
  assertCount(t.projects, f.projects.truncated, 'totals.projects');
  assertCount(t.labels, f.labels.truncated, 'totals.labels');
  assertCount(t.active_tasks, f.tasks.truncated, 'totals.active_tasks');
  assertCount(t.due_today, f.tasks.truncated, 'totals.due_today');
  assertCount(t.overdue, f.tasks.truncated, 'totals.overdue');
  assertCount(payload.tasks_in_unlisted_projects, f.tasks.truncated, 'tasks_in_unlisted_projects');
  assert.ok(Array.isArray(payload.projects), 'projects is not an array');
  for (const p of payload.projects) {
    assertCount(p.active_task_count, f.tasks.truncated, `projects[${p.id}].active_task_count`);
  }
  if (Object.values(f).some((x) => x.truncated)) {
    assert.ok(
      Array.isArray(payload.warnings) && payload.warnings.length > 0,
      'a fetch was truncated but no warnings were given'
    );
  } else {
    assert.equal(Object.hasOwn(payload, 'warnings'), false, 'warnings present with nothing truncated');
  }
}

// ---- 1. under every cap: all counts exact --------------------------------

test('D-1: below every cap, all counts are exact and nothing is flagged', async () => {
  const { payload } = await overview(account());
  assert.deepEqual(payload.fetches, {
    projects: { fetched: 3, truncated: false },
    sections: { fetched: 11, truncated: false },
    labels: { fetched: 4, truncated: false },
    tasks: { fetched: 413, truncated: false },
  });
  assert.deepEqual(payload.totals.projects, { count: 3, is_floor: false });
  assert.deepEqual(payload.totals.labels, { count: 4, is_floor: false });
  assert.deepEqual(payload.totals.active_tasks, { count: 413, is_floor: false });
  // 413 tasks over 3 projects, assigned round-robin: 138, 138, 137.
  assert.deepEqual(
    payload.projects.map((p) => p.active_task_count),
    [
      { count: 138, is_floor: false },
      { count: 138, is_floor: false },
      { count: 137, is_floor: false },
    ]
  );
  assertFloorsMatchFetches(payload);
});

// ---- tasks fetch is not limited by TODOIST_MAX_ITEMS ----------------------

test('D-1: the tasks fetch is not limited by maxItems', async () => {
  const { payload, requested } = await overview(account());
  const fetched = requested.filter((r) => r.path === '/tasks');
  const total = fetched.reduce((n, r) => n + Math.min(r.limit, 413 - r.offset), 0);
  assert.equal(total, 413, `tasks requests covered ${total} items: ${JSON.stringify(fetched)}`);
  assert.equal(payload.fetches?.tasks?.fetched, 413);
  assert.equal(payload.fetches?.tasks?.truncated, false);
});

// ---- 2. tasks over the 5000 ceiling --------------------------------------

test('D-1: tasks over the 5000 ceiling make every task-derived count a floor', async () => {
  const { payload } = await overview(account({ tasks: 5173 }));
  assert.deepEqual(payload.fetches?.tasks, { fetched: 5000, truncated: true });
  assert.deepEqual(payload.totals.active_tasks, { count: 5000, is_floor: true });
  assertCount(payload.totals.due_today, true, 'totals.due_today');
  assertCount(payload.totals.overdue, true, 'totals.overdue');
  assertCount(payload.tasks_in_unlisted_projects, true, 'tasks_in_unlisted_projects');
  for (const p of payload.projects) {
    assertCount(p.active_task_count, true, `projects[${p.id}].active_task_count`);
  }
  // Counts from untruncated fetches stay exact.
  assert.deepEqual(payload.totals.projects, { count: 3, is_floor: false });
  assert.deepEqual(payload.totals.labels, { count: 4, is_floor: false });
  assert.ok(
    payload.warnings?.some((w) => /tasks/.test(w)),
    `no warning names the tasks fetch: ${JSON.stringify(payload.warnings)}`
  );
  assert.equal(TASK_CEILING, 5000);
  assertFloorsMatchFetches(payload);
});

// ---- 3. projects truncated at maxItems -----------------------------------

test('D-1: projects over maxItems make totals.projects a floor, task counts stay exact', async () => {
  const { payload } = await overview(account({ projects: 53 }));
  assert.deepEqual(payload.fetches?.projects, { fetched: MAX_ITEMS, truncated: true });
  assert.deepEqual(payload.totals.projects, { count: MAX_ITEMS, is_floor: true });
  assert.deepEqual(payload.totals.active_tasks, { count: 413, is_floor: false });
  assert.equal(payload.projects.length, MAX_ITEMS);
  assert.ok(
    payload.warnings?.some((w) => /projects/.test(w)),
    `no warning names the projects fetch: ${JSON.stringify(payload.warnings)}`
  );
  // Tasks round-robin over p0..p52; those in p37..p52 have no listed project.
  const unlisted = Array.from({ length: 413 }, (_, i) => i % 53).filter((p) => p >= MAX_ITEMS).length;
  assert.deepEqual(payload.tasks_in_unlisted_projects, { count: unlisted, is_floor: false });
  assertFloorsMatchFetches(payload);
});

// ---- 4. labels truncated at maxItems -------------------------------------

test('D-1: labels over maxItems make totals.labels a floor', async () => {
  const { payload } = await overview(account({ labels: 61 }));
  assert.deepEqual(payload.fetches?.labels, { fetched: MAX_ITEMS, truncated: true });
  assert.deepEqual(payload.totals.labels, { count: MAX_ITEMS, is_floor: true });
  assert.equal(payload.labels.length, MAX_ITEMS);
  assert.deepEqual(payload.totals.projects, { count: 3, is_floor: false });
  assert.deepEqual(payload.totals.active_tasks, { count: 413, is_floor: false });
  assertFloorsMatchFetches(payload);
});

// ---- 5. sections truncated at maxItems -----------------------------------

test('D-1: sections over maxItems are reported truncated and mark no count as a floor', async () => {
  const { payload } = await overview(account({ sections: 59 }));
  assert.deepEqual(payload.fetches?.sections, { fetched: MAX_ITEMS, truncated: true });
  assert.ok(
    payload.warnings?.some((w) => /sections/.test(w)),
    `no warning names the sections fetch: ${JSON.stringify(payload.warnings)}`
  );
  assertFloorsMatchFetches(payload);
});

// ---- 7. orphans are surfaced, not dropped --------------------------------

test('D-1: a section or task whose project is not listed is surfaced', async () => {
  const { payload } = await overview(
    account({
      extra: {
        sections: [{ id: 's-orphan', name: 'Someday', project_id: 'p-missing' }],
        tasks: [
          { id: 't-orphan-1', content: 'x', project_id: 'p-missing', due: null },
          { id: 't-orphan-2', content: 'y', project_id: 'p-missing', due: null },
        ],
      },
    })
  );
  const orphans = payload.unmatched_sections;
  assert.ok(Array.isArray(orphans), `unmatched_sections missing: ${JSON.stringify(Object.keys(payload))}`);
  assert.equal(orphans.length, 1, JSON.stringify(orphans));
  assert.equal(orphans[0].project_id, 'p-missing');
  assert.match(orphans[0].name, /Someday/);
  assert.deepEqual(payload.tasks_in_unlisted_projects, { count: 2, is_floor: false });
  assert.deepEqual(payload.totals.active_tasks, { count: 415, is_floor: false });
  assertFloorsMatchFetches(payload);
});

test('D-1: sections of projects cut off by a truncated projects fetch are surfaced', async () => {
  const { payload } = await overview(account({ projects: 53, sections: 11 }));
  // 11 sections on p0..p10 are all within the first 37 projects: none orphaned.
  assert.deepEqual(payload.unmatched_sections, []);
  const { payload: p2 } = await overview(
    account({
      projects: 53,
      extra: { sections: [{ id: 's-late', name: 'Late', project_id: 'p52' }] },
    })
  );
  assert.equal(p2.unmatched_sections?.length, 1, JSON.stringify(p2.unmatched_sections));
  assert.equal(p2.unmatched_sections[0].project_id, 'p52');
});

// ---- 8. unconditional note removed ---------------------------------------

test('D-1: the unconditional note is gone, truncated or not', async () => {
  for (const data of [account(), account({ tasks: 5173 })]) {
    const { payload, text } = await overview(data);
    assert.equal(Object.hasOwn(payload, 'note'), false, 'note key still present');
    assert.ok(!text.includes('Counts reflect up to the configured item cap'), 'note text still present');
  }
});

// ---- 9. signal keys before the large name lists --------------------------

test('D-1: signal keys precede the name lists so capOutput cuts the lists first', async () => {
  const { payload: under } = await overview(account());
  assert.deepEqual(Object.keys(under), [
    'fetches',
    'totals',
    'tasks_in_unlisted_projects',
    'unmatched_sections',
    'labels',
    'projects',
  ]);
  const { payload: over } = await overview(account({ tasks: 5173 }));
  assert.deepEqual(Object.keys(over), [
    'fetches',
    'warnings',
    'totals',
    'tasks_in_unlisted_projects',
    'unmatched_sections',
    'labels',
    'projects',
  ]);
});
