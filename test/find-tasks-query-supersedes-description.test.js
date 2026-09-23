/**
 * D-3 (docs/SPEC.md section 7, R21): `find-tasks` sends only `query` when a
 * non-empty query is supplied, and drops project_id / section_id / label /
 * parent_id / ids. The behavior stays; the text the agent reads must say so.
 *
 * These tests read that text the way the agent receives it: they spawn the
 * real stdio entry point (src/index.js) as a child process and read the
 * `tools/list` response over MCP. They do not import the schema object.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ENTRY = fileURLToPath(new URL('../src/index.js', import.meta.url));
const FILTERS = ['project_id', 'section_id', 'label', 'parent_id', 'ids'];
// Todoist's filter syntax can select these by name (#Project, /Section,
// %label), so a combined constraint belongs in the query.
const BY_NAME_IN_QUERY = ['project_id', 'section_id', 'label'];
// No query syntax selects the subtasks of a given parent or specific task
// ids, so the only way to filter by these is to omit the query.
const NOT_EXPRESSIBLE_IN_QUERY = ['parent_id', 'ids'];

let client;
let findTasks;

before(async () => {
  client = new Client({ name: 'd3-description-test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [ENTRY],
      // A dummy token: tools/list never calls Todoist. Read-only mode still
      // registers find-tasks.
      env: { PATH: process.env.PATH ?? '', TODOIST_API_KEY: 'd3-dummy-token-not-real' },
      stderr: 'ignore',
    })
  );
  const { tools } = await client.listTools();
  findTasks = tools.find((t) => t.name === 'find-tasks');
});

after(async () => {
  await client?.close();
});

// What the assertions key on, and why.
//
// Mentioning `query` is not enough: today's text already names `query` next
// to the five filters and still reads as if they combine. So each check
// requires one SENTENCE that ties `query` to the filter through a
// replacement verb, and a second sentence that tells the agent where a
// combined constraint goes:
//
//   1. Replacement: a sentence containing the word "query" AND a verb of
//      replacement (replace / supersede / override / ignore, any inflection),
//      not negated ("does not replace" is rejected). For the tool
//      description, that same sentence must also name all five filters, so
//      it cannot be a statement about some other field.
//   2. Combination: a sentence containing a combining word (combine /
//      together / alongside / both) AND a phrase placing something inside
//      the query ("in the query", "inside the query", "within the query",
//      "into the query").
//
//   3. parent_id and ids only: the query syntax cannot select by these, so
//      check 2 is replaced by two checks. The text must tell the agent to
//      omit the query ("omit `query`", "leave out the query", and similar),
//      and it must NOT tell the agent to put the constraint in the query:
//      any sentence with a placing verb (put / place / add / include /
//      combine) followed by an in-the-query phrase is rejected, because
//      following it would produce a query Todoist does not support.
//
// Keying on the sentence rather than the whole text stops "query" in one
// sentence and "ignored" in an unrelated one from satisfying the check.
// Today's text has no replacement verb and no in-the-query phrase anywhere,
// so every check fails on it.

const REPLACE = /\b(replac|supersed|overrid|ignor)\w*/i;
const NEGATED_REPLACE = /\b(not|never|no longer)\b[^.]{0,20}\b(replac|supersed|overrid|ignor)|n't\s+(\w+\s+)?(replac|supersed|overrid|ignor)/i;
const COMBINE = /\b(combin\w*|together|alongside|both)\b/i;
const INSIDE_QUERY = /\b(in|inside|within|into)\s+(the\s+)?`?query`?\b/i;
const OMIT_QUERY = /\b(omit|leave out|drop|remove)\s+(the\s+)?`?query`?(?!\w)/i;
const PUT_IN_QUERY = /\b(put|place|add|include|combin\w*)\b[^.;]*\b(in|inside|within|into)\s+(the\s+)?`?query`?(?!\w)/i;

// Split on sentence ends followed by a capital or backtick, so "e.g. \"today\""
// does not split mid-sentence.
function sentences(text) {
  return (text ?? '').split(/(?<=[.!?])\s+(?=[A-Z`])/);
}

function hasReplacementSentence(text, mustName = []) {
  return sentences(text).some(
    (s) =>
      /\bquery\b/i.test(s) &&
      REPLACE.test(s) &&
      !NEGATED_REPLACE.test(s) &&
      mustName.every((n) => new RegExp(`\\b${n}\\b`).test(s))
  );
}

function hasCombineInsideQuerySentence(text) {
  return sentences(text).some((s) => COMBINE.test(s) && INSIDE_QUERY.test(s));
}

function hasOmitQuerySentence(text) {
  return sentences(text).some((s) => OMIT_QUERY.test(s));
}

function hasPutInQueryWording(text) {
  return sentences(text).some((s) => PUT_IN_QUERY.test(s));
}

test('find-tasks is served over stdio tools/list with an input schema', () => {
  assert.ok(findTasks, 'find-tasks must appear in tools/list');
  for (const f of FILTERS) {
    assert.ok(findTasks.inputSchema.properties[f], `inputSchema must expose ${f}`);
  }
});

test('find-tasks description states that query replaces all five filters', () => {
  const desc = findTasks.description;
  assert.ok(
    hasReplacementSentence(desc, FILTERS),
    'find-tasks description needs one sentence saying `query` replaces ' +
      `${FILTERS.join(', ')}. Got: ${JSON.stringify(desc)}`
  );
  assert.ok(
    hasCombineInsideQuerySentence(desc),
    'find-tasks description must say that to combine filters the constraint goes ' +
      `inside the query. Got: ${JSON.stringify(desc)}`
  );
});

for (const field of BY_NAME_IN_QUERY) {
  test(`find-tasks ${field} description states that query replaces it`, () => {
    const desc = findTasks.inputSchema.properties[field].description;
    assert.ok(
      hasReplacementSentence(desc),
      `${field} description needs a sentence saying a non-empty \`query\` replaces ` +
        `this filter. Got: ${JSON.stringify(desc)}`
    );
    assert.ok(
      hasCombineInsideQuerySentence(desc),
      `${field} description must say that to combine it with a query the constraint ` +
        `goes inside the query. Got: ${JSON.stringify(desc)}`
    );
  });
}

for (const field of NOT_EXPRESSIBLE_IN_QUERY) {
  test(`find-tasks ${field} description states that query replaces it and to omit query`, () => {
    const desc = findTasks.inputSchema.properties[field].description;
    assert.ok(
      hasReplacementSentence(desc),
      `${field} description needs a sentence saying a non-empty \`query\` replaces ` +
        `this filter. Got: ${JSON.stringify(desc)}`
    );
    assert.ok(
      hasOmitQuerySentence(desc),
      `${field} description must tell the agent to omit the query to filter by it. ` +
        `Got: ${JSON.stringify(desc)}`
    );
    assert.ok(
      !hasPutInQueryWording(desc),
      `${field} cannot be expressed in the query syntax, so its description must not ` +
        `say to put it in the query. Got: ${JSON.stringify(desc)}`
    );
  });
}
