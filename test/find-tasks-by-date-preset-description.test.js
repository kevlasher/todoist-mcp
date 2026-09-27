/**
 * find-tasks-by-date's description must say what each preset sends.
 *
 * Found in Session 21: the `today` preset sends the Todoist filter
 * `today | overdue`, so it returns overdue tasks as well as tasks due today,
 * but the description listed it only as "today". The behavior stays; the text
 * the agent reads must say so (docs/SPEC.md section 7, R22).
 *
 * The description is read the way the agent receives it, as D-3's test does:
 * the real stdio entry point (src/index.js) is spawned and its `tools/list`
 * response read over MCP. What each preset sends is not written into this
 * file. It is observed: every preset named in the served schema's enum is
 * called in-process with fetch stubbed, and the `query` parameter of the
 * request it makes is recorded.
 *
 * Bug class: a preset whose description does not say what it sends. The
 * second test requires the served description to contain, verbatim, the
 * filter every preset sends, whenever that filter differs from the preset's
 * name. A new preset is covered as soon as it appears in the enum.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

const ENTRY = fileURLToPath(new URL('../src/index.js', import.meta.url));

// Fixture values avoid the implementation defaults (SPEC section 8).
const serverCfg = {
  apiKey: 'preset-description-token-not-real-0123456789',
  readOnly: true,
  maxOutputChars: 43211,
  maxFieldChars: 1234,
  maxItems: 7,
};

let stdioClient;
let tool;

before(async () => {
  stdioClient = new Client({ name: 'preset-description-test', version: '0.0.1' });
  await stdioClient.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [ENTRY],
      // A dummy token: tools/list never calls Todoist.
      env: { PATH: process.env.PATH, TODOIST_API_KEY: 'preset-dummy-token-not-real' },
      stderr: 'ignore',
    })
  );
  const { tools } = await stdioClient.listTools();
  tool = tools.find((t) => t.name === 'find-tasks-by-date');
});

after(async () => {
  await stdioClient?.close();
});

/** Call find-tasks-by-date with `preset` and return the filter query it sent. */
async function sentQuery(preset) {
  const queries = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    queries.push(new URL(url).searchParams.get('query'));
    const body = { results: [], next_cursor: null };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  try {
    const { server } = createServer(serverCfg);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'preset-query', version: '0.0.1' });
    await Promise.all([client.connect(ct), server.connect(st)]);
    const res = await client.callTool({ name: 'find-tasks-by-date', arguments: { preset } });
    await client.close();
    assert.ok(!res.isError, `preset ${preset} returned an error: ${JSON.stringify(res.content)}`);
  } finally {
    globalThis.fetch = orig;
  }
  assert.equal(queries.length, 1, `preset ${preset} should make exactly one request`);
  return queries[0];
}

// Split on sentence ends followed by a capital or backtick, as D-3's test does.
function sentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z`])/);
}

/**
 * The presets whose filter the description does not state verbatim, given
 * `sent`, a map from preset name to the filter it sends. A preset whose
 * filter is its own name needs no statement.
 */
function missingPresetFilters(desc, sent) {
  return Object.entries(sent)
    .filter(([preset, query]) => query !== preset && !desc.includes(query))
    .map(([preset, query]) => `${preset} sends "${query}"`);
}

test('find-tasks-by-date is served over stdio with a preset enum', () => {
  assert.ok(tool, 'find-tasks-by-date must appear in tools/list');
  const presets = tool.inputSchema.properties.preset.enum;
  assert.ok(Array.isArray(presets) && presets.includes('today'), 'preset enum must include today');
});

test('the today preset sends a filter that includes overdue tasks, and the description says so', async () => {
  const query = await sentQuery('today');
  assert.match(query, /\boverdue\b/, 'fixture premise: the today preset includes overdue');
  const desc = tool.description;
  assert.ok(
    sentences(desc).some((s) => /\btoday\b/.test(s) && /\binclud\w*\b[^.]*\boverdue\b/i.test(s)),
    'find-tasks-by-date description needs a sentence saying the today preset includes ' +
      `overdue tasks. Got: ${JSON.stringify(desc)}`
  );
});

test('the description states, verbatim, the filter every preset sends when it differs from the name', async () => {
  const desc = tool.description;
  const sent = {};
  for (const preset of tool.inputSchema.properties.preset.enum) {
    sent[preset] = await sentQuery(preset);
  }
  const missing = missingPresetFilters(desc, sent);
  assert.deepEqual(
    missing,
    [],
    `find-tasks-by-date description omits what these presets send. Got: ${JSON.stringify(desc)}`
  );
});

test('the preset check flags an omitted filter and accepts one stated or equal to its name', () => {
  const sent = { today: 'today | overdue', overdue: 'overdue', nodate: 'no date' };
  assert.deepEqual(missingPresetFilters('today sends "today | overdue".', sent), [
    'nodate sends "no date"',
  ]);
  assert.deepEqual(missingPresetFilters('today | overdue, no date', sent), []);
});
