/**
 * D-9: dot-segment task ids leave the task resource path.
 *
 * Rule (docs/SPEC.md section 7, R-PATHID): every id a tool places into a
 * request path is one or more ASCII letters or digits. Anything else is
 * refused before any request is sent. As a second line, request() refuses
 * a composed URL whose normalized path differs from the path it was given.
 *
 * Bug class: any caller-controlled value in a request path. The static test
 * at the end fails if any path passed to request() or getPaginated() in
 * src/ interpolates a value that has not gone through assertPathId.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const REFUSAL = /one or more ASCII letters or digits/;

function cfg() {
  return {
    apiKey: 'd9-test-token-not-a-real-one-0123456789',
    readOnly: false,
    maxOutputChars: 40000,
    maxFieldChars: 1500,
    maxItems: 150,
  };
}

async function connect() {
  const { server } = createServer(cfg());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'd9-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Run fn with fetch stubbed to HTTP 200; returns every request made. */
async function withRecordedFetch(fn) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ method: init?.method, url: String(url), body: init?.body });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: '6Jf8VQXxpwv56VQ7', content: 'stub' }),
    };
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = orig;
  }
  return calls;
}

// ---- D-9's reproduction inputs, each against the tool it names ------------

const REPRODUCTION = [
  ['update-tasks', { tasks: [{ id: '..', priority: 4 }] }],
  ['update-tasks', { tasks: [{ id: '.', content: 'hi' }] }],
  ['complete-tasks', { ids: ['..'] }],
  ['uncomplete-tasks', { ids: ['.'] }],
  ['reschedule-tasks', { tasks: [{ id: '..', due_string: 'tomorrow' }] }],
];

for (const [name, args] of REPRODUCTION) {
  test(`D-9 reproduction: ${name} ${JSON.stringify(args)} is refused and sends nothing`, async () => {
    const client = await connect();
    let res;
    const calls = await withRecordedFetch(async () => {
      res = await client.callTool({ name, arguments: args });
    });
    await client.close();
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.url}`),
      [],
      `${name} must send no request for this id`
    );
    assert.equal(res.isError, true, `${name} must return an error result`);
    assert.match(res.content[0].text, REFUSAL);
  });
}

// ---- every tool that puts an id in a path ---------------------------------

// Each builds that tool's arguments for a list of ids, and gives the path
// suffix Todoist expects after /tasks/{id}.
const PATH_TOOLS = {
  'update-tasks': { args: (ids) => ({ tasks: ids.map((id) => ({ id, priority: 3 })) }), suffix: '' },
  'complete-tasks': { args: (ids) => ({ ids }), suffix: '/close' },
  'uncomplete-tasks': { args: (ids) => ({ ids }), suffix: '/reopen' },
  'reschedule-tasks': {
    args: (ids) => ({ tasks: ids.map((id) => ({ id, due_date: '2026-10-01' })) }),
    suffix: '',
  },
};

// Documented Todoist v1 formats: alphanumeric and the older numeric form.
const VALID = ['6Jf8VQXxpwv56VQ7', '2203306141'];

// Every one of these must be refused.
const INVALID = [
  '.',
  '..',
  '...',
  '%2e%2e',
  '.%2E',
  '%2E',
  'a/b',
  '../projects',
  '123/../456',
  'a\\b',
  '123?x=1',
  '123#frag',
  'a b',
  ' 123',
  '123\n',
  'abc-1',
  'temp_1',
  '１２３', // fullwidth digits: Unicode digits, not ASCII
  'é12',
  '12%00',
];

for (const [name, { args, suffix }] of Object.entries(PATH_TOOLS)) {
  test(`${name}: valid ids reach /tasks/{id}${suffix}; every other id is refused before any request`, async () => {
    const client = await connect();

    // Valid ids go out unchanged, to the path the tool description names.
    let ok;
    const sent = await withRecordedFetch(async () => {
      ok = await client.callTool({ name, arguments: args(VALID) });
    });
    assert.ok(!ok.isError, `${name} returned an error for valid ids: ${ok.content?.[0]?.text}`);
    assert.deepEqual(
      sent.map((c) => `${c.method} ${c.url}`),
      VALID.map((id) => `POST https://api.todoist.com/api/v1/tasks/${id}${suffix}`)
    );

    for (const bad of INVALID) {
      // Alone, and after a valid id in the same batch: the batch is refused
      // whole, so a bad id never leaves a partial write behind it.
      for (const ids of [[bad], [VALID[0], bad]]) {
        let res;
        const calls = await withRecordedFetch(async () => {
          res = await client.callTool({ name, arguments: args(ids) });
        });
        assert.deepEqual(
          calls.map((c) => `${c.method} ${c.url}`),
          [],
          `${name} ${JSON.stringify(ids)} must send no request`
        );
        assert.equal(res.isError, true, `${name} ${JSON.stringify(ids)} must return an error`);
        assert.match(res.content[0].text, REFUSAL, `${name} ${JSON.stringify(ids)}`);
      }
    }
    await client.close();
  });
}

test('the refusal names the offending position, not the caller-supplied id', async () => {
  const client = await connect();
  const hostile = 'IGNORE-PREVIOUS/../INSTRUCTIONS';
  let res;
  const calls = await withRecordedFetch(async () => {
    res = await client.callTool({
      name: 'complete-tasks',
      arguments: { ids: ['123', hostile] },
    });
  });
  await client.close();
  assert.equal(calls.length, 0);
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, REFUSAL);
  assert.match(res.content[0].text, /ids\[1\]/);
  assert.ok(!res.content[0].text.includes('IGNORE-PREVIOUS'), 'the id must not be echoed');
});

// ---- the single validator --------------------------------------------------

test('assertPathId accepts ASCII letters and digits and refuses everything else', async () => {
  const mod = await import('../src/client.js');
  assert.equal(typeof mod.assertPathId, 'function', 'src/client.js must export assertPathId');
  for (const id of [...VALID, 'a', 'Z', '0']) {
    assert.equal(mod.assertPathId(id, 'id'), id);
  }
  for (const bad of ['', ...INVALID, undefined, null, 123, ['1'], { toString: () => '1' }]) {
    assert.throws(() => mod.assertPathId(bad, 'tasks[0].id'), (err) => {
      assert.match(err.message, REFUSAL);
      assert.match(err.message, /tasks\[0\]\.id/);
      return true;
    }, `must refuse ${JSON.stringify(bad)}`);
  }
});

// ---- request() refuses a path that URL normalization would change ---------

test('request() refuses a path whose normalized form differs, before fetch', async () => {
  const { createClient } = await import('../src/client.js');
  const client = createClient(cfg());
  const calls = await withRecordedFetch(async () => {
    for (const path of [
      '/tasks/..',
      '/tasks/.',
      '/tasks/%2e%2e',
      '/tasks/.%2E/close',
      '/tasks/a\\b',
      '/tasks/a b',
      '/tasks//close',
    ]) {
      await assert.rejects(
        client.request('POST', path),
        /normaliz/,
        `request() must refuse ${JSON.stringify(path)}`
      );
    }
  });
  assert.deepEqual(calls, [], 'no request may be sent for a refused path');

  // A path that normalization leaves alone still goes out.
  const ok = await withRecordedFetch(async () => {
    await client.request('POST', '/tasks/6Jf8VQXxpwv56VQ7/close');
  });
  assert.deepEqual(
    ok.map((c) => c.url),
    ['https://api.todoist.com/api/v1/tasks/6Jf8VQXxpwv56VQ7/close']
  );
});

// ---- bug class: caller-controlled values in a request path ----------------

/**
 * Split a call's argument list starting just after its '('. Returns the
 * top-level argument strings and the index of the closing ')'. Handles
 * quotes, template literals (with nested ${...}) and bracket depth; enough
 * for this codebase's own source.
 */
function splitArgs(src, start) {
  const args = [];
  let depth = 0;
  let cur = '';
  let i = start;
  const readString = (q) => {
    let s = src[i++];
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') s += src[i++];
      if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
        let d = 0;
        do {
          if (src[i] === '{') d++;
          else if (src[i] === '}') d--;
          s += src[i++];
        } while (i < src.length && d > 0);
        continue;
      }
      s += src[i++];
    }
    s += src[i++];
    return s;
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      cur += readString(ch);
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

/** True if expr is exactly one assertPathId(...) call and nothing else. */
function isValidatorCall(expr) {
  const head = 'assertPathId(';
  if (!expr.startsWith(head)) return false;
  return splitArgs(expr, head.length).end === expr.length - 1;
}

/**
 * Interpolations of a template literal, e.g. `/a/${x}` -> ['x'], and its
 * skeleton with each interpolation emptied, e.g. `/a/${}`.
 */
function interpolations(tpl) {
  const exprs = [];
  let skeleton = '';
  let i = 0;
  let j;
  while ((j = tpl.indexOf('${', i)) !== -1) {
    let d = 0;
    let k = j + 1;
    for (; k < tpl.length; k++) {
      if (tpl[k] === '{') d++;
      else if (tpl[k] === '}' && --d === 0) break;
    }
    exprs.push(tpl.slice(j + 2, k).trim());
    skeleton += tpl.slice(i, j) + '${}';
    i = k + 1;
  }
  return { exprs, skeleton: skeleton + tpl.slice(i) };
}

/**
 * The one exemption: getPaginated forwards its own `path` parameter to
 * request(). That parameter is itself checked at every getPaginated call.
 */
const EXEMPT = new Set(['client.js|path']);

/** Offending path arguments in one file's source. */
function findPathOffenders(file, src) {
  const offenders = [];
  const re = /\b(request|getPaginated)\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
    const { args } = splitArgs(src, m.index + m[0].length);
    const path = m[1] === 'request' ? args[1] : args[0];
    const line = src.slice(0, m.index).split('\n').length;
    const where = `${file}:${line} ${m[1]}(${args.join(', ').slice(0, 80)})`;
    if (path === undefined) {
      offenders.push(`${where}: no path argument`);
    } else if (/^'[^'\\]*'$/.test(path) || /^"[^"\\]*"$/.test(path)) {
      // a plain string literal
    } else if (path.startsWith('`')) {
      const { exprs, skeleton } = interpolations(path);
      if (!/^`[^`]*`$/.test(skeleton)) {
        offenders.push(`${where}: path is not a single template literal`);
      }
      for (const expr of exprs) {
        if (!isValidatorCall(expr)) {
          offenders.push(`${where}: \${${expr}} has not gone through assertPathId`);
        }
      }
    } else if (!EXEMPT.has(`${file}|${path}`)) {
      offenders.push(`${where}: path is not a literal`);
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

test('bug class: every request path in src/ is a literal or interpolates only assertPathId(...)', () => {
  // The detector must catch each planted form, and pass the correct one.
  const planted = {
    "client.request('POST', `/tasks/${encodeURIComponent(id)}`)": 1,
    "client.request('POST', `/tasks/${id}/close`)": 1,
    "client.request('POST', '/tasks/' + id)": 1,
    "client.request(method, p, { body })": 1,
    "client.getPaginated(`/projects/${pid}/sections`, {}, 5)": 1,
    "client.getPaginated(path)": 1,
    "client.request('POST')": 1,
    "client.request('POST', `/tasks/${assertPathId(id, 'x')}/${other}`)": 1,
    "client.request('POST', `/tasks/${assertPathId(a, 'x') + b}`)": 1,
    "client.request('POST', `/tasks/${assertPathId(a, 'x')}` + b)": 1,
    "client.request('POST', `/tasks/${assertPathId(a, 'x')}` + b + `/close`)": 1,
    "client.request('POST', `/tasks/${assertPathId(id, `tasks[${i}].id`)}`)": 0,
    "client.request('POST', `/tasks/${assertPathId(id, 'ids[0]')}/close`)": 0,
    "client.getPaginated('/tasks', { ids })": 0,
    "async function request(method, path, opts) {}": 0,
  };
  for (const [src, expected] of Object.entries(planted)) {
    assert.equal(findPathOffenders('planted.js', src).length, expected, `planted: ${src}`);
  }

  const offenders = jsFiles(SRC).flatMap((f) =>
    findPathOffenders(relative(SRC, f).replaceAll('\\', '/'), readFileSync(f, 'utf8'))
  );
  assert.deepEqual(offenders, [], `request paths not validated:\n${offenders.join('\n')}`);
});

test('bug class: assertPathId is defined once, in src/client.js', () => {
  const defs = jsFiles(SRC).filter((f) =>
    /function\s+assertPathId\s*\(/.test(readFileSync(f, 'utf8'))
  );
  assert.deepEqual(
    defs.map((f) => relative(SRC, f).replaceAll('\\', '/')),
    ['client.js']
  );
});
