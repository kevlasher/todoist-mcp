/**
 * D-10 (docs/SPEC.md section 10): a read tool's `limit` is not bounded by
 * TODOIST_MAX_ITEMS.
 *
 * Decision (recorded under R17): a read tool's `limit` may lower the item cap
 * but never raise it. The effective cap is the smaller of `limit` and
 * cfg.maxItems. A `limit` above cfg.maxItems is not an error; it is held to
 * cfg.maxItems, and the existing `truncated` flag reports when the list was
 * cut short. get-overview's fixed task ceiling (R24) is not affected.
 *
 * The behavioral tests use D-10's reproduction input: maxItems 5, a fetch
 * stub that always offers another page, and `limit: 500`. They run against
 * every read tool whose tools/list schema has a `limit`, found at run time,
 * find-tasks once per endpoint and find-comments once per scope. Fixture values avoid the defaults per
 * SPEC section 8: maxItems 5 (default 200), maxFieldChars 1500 (2000),
 * maxOutputChars 123457 (50000). The lower limit is 3.
 *
 * Bug class: any caller-supplied value that can raise a configured cap. The
 * static test at the end fails if a cap argument passed to getPaginated,
 * safeField or capOutput anywhere in src/ is not one of the forms bounded by
 * configuration, or if any file but src/config.js writes a cap key.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { UNTRUSTED_NOTICE } from '../src/sanitize.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

const MAX_ITEMS = 5;
const OVER_LIMIT = 500;
const UNDER_LIMIT = 3;

const serverCfg = {
  apiKey: 'd10-test-token-not-a-real-one-0123456789',
  readOnly: true,
  maxOutputChars: 123457,
  maxFieldChars: 1500,
  maxItems: MAX_ITEMS,
};

/**
 * Every read tool that takes a `limit`, with the other arguments it needs
 * and the endpoint and payload key it should use. find-tasks appears once
 * per endpoint, find-comments once per scope (task_id, project_id).
 */
const CASES = [
  { tool: 'find-tasks', args: {}, path: '/tasks', key: 'tasks' },
  { tool: 'find-tasks', args: { query: 'p1 & #Work' }, path: '/tasks/filter', key: 'tasks' },
  { tool: 'find-tasks-by-date', args: { preset: 'overdue' }, path: '/tasks/filter', key: 'tasks' },
  { tool: 'find-projects', args: {}, path: '/projects', key: 'projects' },
  { tool: 'find-sections', args: {}, path: '/sections', key: 'sections' },
  { tool: 'find-labels', args: {}, path: '/labels', key: 'labels' },
  { tool: 'find-comments', args: { task_id: 'abc123' }, path: '/comments', key: 'comments' },
  { tool: 'find-comments', args: { project_id: 'def456' }, path: '/comments', key: 'comments' },
];

/**
 * D-10's fetch stub: every page is full at the requested limit and offers a
 * next cursor, so only the cap stops pagination.
 */
function endlessApi() {
  const requested = [];
  let served = 0;
  const fetch = async (url) => {
    const u = new URL(url);
    const limit = Number(u.searchParams.get('limit'));
    requested.push({ path: u.pathname.replace(/^\/api\/v1/, ''), limit });
    const results = Array.from({ length: limit }, () => {
      const n = served++;
      return { id: `x${n}`, content: `Item ${n}`, name: `Item ${n}`, project_id: 'p0' };
    });
    const body = { results, next_cursor: `c${served}` };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetch, requested };
}

async function connect() {
  const { server } = createServer(serverCfg);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'd10-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function call(tool, args) {
  const api = endlessApi();
  const orig = globalThis.fetch;
  globalThis.fetch = api.fetch;
  try {
    const client = await connect();
    const res = await client.callTool({ name: tool, arguments: args });
    await client.close();
    assert.ok(!res.isError, `${tool} returned an error: ${res.content?.[0]?.text}`);
    const text = res.content.map((c) => c.text).join('\n');
    const prefix = `${UNTRUSTED_NOTICE}\n\n`;
    assert.ok(text.startsWith(prefix), 'fixture error: result does not start with the notice');
    // Parsed on demand: an unbounded fetch can overflow maxOutputChars, so a
    // test asserts on the requests before it reads the payload.
    return { payload: () => JSON.parse(text.slice(prefix.length)), requested: api.requested };
  } finally {
    globalThis.fetch = orig;
  }
}

/** Items the client asked the API for, summed over every page request. */
function itemsRequested(requested, path, where) {
  assert.ok(requested.length > 0, `${where}: no request was made`);
  for (const r of requested) assert.equal(r.path, path, `${where}: unexpected path ${r.path}`);
  return requested.reduce((n, r) => n + r.limit, 0);
}

function label({ tool, args }) {
  return `${tool} ${JSON.stringify(args)}`;
}

test('D-10: the read tools that take a limit are exactly the six in this file', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  await client.close();
  const withLimit = tools
    .filter((t) => Object.hasOwn(t.inputSchema?.properties ?? {}, 'limit'))
    .map((t) => t.name)
    .sort();
  assert.deepEqual(withLimit, [...new Set(CASES.map((c) => c.tool))].sort());
  // get-overview takes no limit: its ceiling is fixed (R24).
  const overview = tools.find((t) => t.name === 'get-overview');
  assert.ok(overview, 'get-overview is not listed');
  assert.equal(Object.hasOwn(overview.inputSchema?.properties ?? {}, 'limit'), false);
});

for (const c of CASES) {
  test(`D-10: ${label(c)} with limit ${OVER_LIMIT} fetches at most maxItems and reports truncated`, async () => {
    const where = label(c);
    const res = await call(c.tool, { ...c.args, limit: OVER_LIMIT });
    const asked = itemsRequested(res.requested, c.path, where);
    assert.ok(
      asked <= MAX_ITEMS,
      `${where}: asked the API for ${asked} items with maxItems ${MAX_ITEMS}: ${JSON.stringify(res.requested)}`
    );
    const payload = res.payload();
    assert.equal(payload.count, MAX_ITEMS, `${where}: count`);
    assert.equal(payload[c.key].length, MAX_ITEMS, `${where}: ${c.key} length`);
    assert.equal(payload.truncated, true, `${where}: truncated`);
  });

  test(`D-10: ${label(c)} with limit ${UNDER_LIMIT} fetches only that many`, async () => {
    const where = label(c);
    const res = await call(c.tool, { ...c.args, limit: UNDER_LIMIT });
    const payload = res.payload();
    assert.equal(itemsRequested(res.requested, c.path, where), UNDER_LIMIT, `${where}: items requested`);
    assert.equal(payload.count, UNDER_LIMIT, `${where}: count`);
    assert.equal(payload.truncated, true, `${where}: truncated`);
  });

  test(`D-10: ${label(c)} with no limit fetches maxItems`, async () => {
    const where = label(c);
    const res = await call(c.tool, { ...c.args });
    const payload = res.payload();
    assert.equal(itemsRequested(res.requested, c.path, where), MAX_ITEMS, `${where}: items requested`);
    assert.equal(payload.count, MAX_ITEMS, `${where}: count`);
    assert.equal(payload.truncated, true, `${where}: truncated`);
  });
}

// ---- bug class: a caller-supplied value that can raise a configured cap ----

/**
 * The arguments of a call whose opening parenthesis ends at `start`, split
 * at top-level commas. Strings and template literals are skipped whole.
 */
function splitArgs(src, start) {
  const args = [];
  let depth = 0;
  let cur = '';
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      let s = src[i++];
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\') s += src[i++];
        s += src[i++];
      }
      cur += s + (src[i++] ?? '');
      continue;
    }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) {
      if (depth === 0) {
        if (cur.trim()) args.push(cur.trim());
        return { args, end: i };
      }
      depth--;
    }
    if (ch === ',' && depth === 0) {
      args.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  return { args, end: -1 };
}

/** True if expr is exactly one itemCap(<limit>, cfg) call and nothing else. */
function isItemCapCall(expr) {
  const head = 'itemCap(';
  if (!expr.startsWith(head)) return false;
  const { args, end } = splitArgs(expr, head.length);
  return end === expr.length - 1 && args.length === 2 && args[1] === 'cfg';
}

/**
 * Each sink that takes a configured cap: which argument is the cap, and the
 * forms that argument may take. `m` and `maxFieldChars` are the local names
 * src/shape.js uses; the file checks below pin what they hold.
 */
const SINKS = {
  getPaginated: {
    index: 2,
    ok: (e) => e === undefined || e === 'cfg.maxItems' || e === 'OVERVIEW_MAX_ITEMS' || isItemCapCall(e),
  },
  safeField: { index: 1, ok: (e, file) => fieldCapOk(e, file) },
  frameLabels: { index: 1, ok: (e, file) => fieldCapOk(e, file) },
  shapeDue: { index: 1, ok: (e, file) => fieldCapOk(e, file) },
  capOutput: { index: 1, ok: (e) => e === 'cfg.maxOutputChars' },
};

function fieldCapOk(e, file) {
  if (e === 'cfg.maxFieldChars') return true;
  return file === 'shape.js' && (e === 'm' || e === 'maxFieldChars');
}

const CAP_KEYS = 'maxItems|maxFieldChars|maxOutputChars';

/**
 * Source with comments blanked out, newlines kept so line numbers hold.
 * Strings and template literals are kept as they are.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      out += src[i++];
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\') out += src[i++];
        out += src[i++];
      }
      out += src[i++] ?? '';
    } else if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += src[i++];
    }
  }
  return out;
}

/** Offending cap arguments and cap writes in one file's source. */
function findCapOffenders(file, text) {
  const src = stripComments(text);
  const offenders = [];
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const re = new RegExp(`\\b(${Object.keys(SINKS).join('|')})\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
    const { args } = splitArgs(src, m.index + m[0].length);
    const { index, ok } = SINKS[m[1]];
    if (!ok(args[index], file)) {
      offenders.push(`${file}:${lineOf(m.index)} ${m[1]}(${args.join(', ').slice(0, 80)}): cap is ${args[index]}`);
    }
  }
  if (file !== 'config.js') {
    // Writing a cap key anywhere but config.js could put a caller's value
    // into cfg: `cfg.maxItems = a.limit`, `{ ...cfg, maxItems: a.limit }`.
    const write = new RegExp(`(\\.\\s*(${CAP_KEYS})\\s*(=(?!=)|\\+=|\\?\\?=|\\|\\|=))|(?<![.\\w$])(${CAP_KEYS})\\s*:`, 'g');
    while ((m = write.exec(src)) !== null) {
      offenders.push(`${file}:${lineOf(m.index)} writes a cap key: ${m[0]}`);
    }
  }
  if (file === 'shape.js') {
    // `m` holds the field cap: every binding of it must be exactly that.
    const bind = /\b(?:const|let|var)\s+m\s*=\s*([^;\n]+)/g;
    while ((m = bind.exec(src)) !== null) {
      if (m[1].trim() !== 'cfg.maxFieldChars') {
        offenders.push(`shape.js:${lineOf(m.index)} m is bound to ${m[1].trim()}`);
      }
    }
    if (/\bm\s*=(?!=)/.test(src.replace(/\b(?:const|let|var)\s+m\s*=/g, ''))) {
      offenders.push('shape.js: m is reassigned');
    }
  }
  return offenders;
}

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return jsFiles(p);
    return p.endsWith('.js') ? [p] : [];
  });
}

test('bug class: every configured cap in src/ is bounded by configuration, never by a caller', () => {
  // The detector must catch each planted form, and pass the correct one.
  const planted = {
    'client.getPaginated(\'/projects\', {}, a.limit ?? cfg.maxItems)': 1,
    'client.getPaginated(\'/tasks\', q, cap)': 1,
    'client.getPaginated(\'/tasks\', q, a.limit)': 1,
    'client.getPaginated(\'/tasks\', q, Math.max(a.limit, cfg.maxItems))': 1,
    'client.getPaginated(\'/tasks\', q, itemCap(a.limit, cfg) + 1)': 1,
    'client.getPaginated(\'/tasks\', q, itemCap(a.limit, other))': 1,
    'client.getPaginated(\'/tasks\', q, itemCap(a.limit, cfg))': 0,
    'client.getPaginated(\'/tasks\', q, cfg.maxItems)': 0,
    'client.getPaginated(\'/tasks\', q, OVERVIEW_MAX_ITEMS)': 0,
    'client.getPaginated(\'/tasks\', q)': 0,
    'safeField(x, a.max_chars)': 1,
    'safeField(x, m)': 1,
    'safeField(x, cfg.maxFieldChars)': 0,
    'capOutput(p, a.max)': 1,
    'capOutput(p, cfg.maxOutputChars)': 0,
    'cfg.maxItems = a.limit;': 1,
    'cfg.maxOutputChars ??= a.limit;': 1,
    'buildResult({ ...cfg, maxOutputChars: a.n }, x)': 1,
    'if (cfg.maxItems === 5) {}': 0,
    'const n = x === undefined ? cfg.maxItems : Math.min(x, cfg.maxItems);': 0,
    'f({ maxItems: 3 })': 1,
    'async function getPaginated(path, query = {}, maxItems) {}': 0,
  };
  for (const [src, expected] of Object.entries(planted)) {
    assert.equal(findCapOffenders('planted.js', src).length, expected, `planted: ${src}`);
  }
  assert.equal(findCapOffenders('shape.js', 'const m = a.limit; safeField(x, m);').length, 1);
  assert.equal(findCapOffenders('shape.js', 'const m = cfg.maxFieldChars; m = 9;').length, 1);
  assert.equal(findCapOffenders('shape.js', 'const m = cfg.maxFieldChars; safeField(x, m);').length, 0);
  assert.equal(findCapOffenders('config.js', 'return { maxItems: intFromEnv(env) };').length, 0);
  // Comments are not code; strings that look like comments are not comments.
  assert.equal(findCapOffenders('planted.js', '// safeField (frame + strip)\n/* capOutput(p, a.n) */').length, 0);
  assert.equal(findCapOffenders('planted.js', "const u = 'https://x'; capOutput(p, a.n)").length, 1);

  const offenders = jsFiles(SRC).flatMap((f) =>
    findCapOffenders(relative(SRC, f).replaceAll('\\', '/'), readFileSync(f, 'utf8'))
  );
  assert.deepEqual(offenders, [], `caps not bounded by configuration:\n${offenders.join('\n')}`);
});

test('bug class: itemCap is defined once, in src/tools/read.js', () => {
  const defs = jsFiles(SRC).filter((f) => /function\s+itemCap\s*\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(
    defs.map((f) => relative(SRC, f).replaceAll('\\', '/')),
    ['tools/read.js']
  );
});
