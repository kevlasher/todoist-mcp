import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { shapeTask, shapeProject } from '../src/shape.js';
import { UNTRUSTED_NOTICE } from '../src/sanitize.js';

/**
 * D-5, fixed by AD-6 (docs/SPEC.md section 4), Session 10: the `url` field is
 * removed from tool output entirely rather than guarded. A live read of
 * GET /tasks and GET /projects returned no url field, consistent with
 * section 9's observation of POST /tasks/{id}, so every raw url site emits
 * nothing today. Removing the key closes the class; anything Todoist adds
 * later under that name is dropped at this server.
 *
 * Each case below feeds an input that DOES carry a url, because a test fed
 * an object without one would pass against today's code and prove nothing.
 * The companion static tripwire is test/no-url-key-in-output.test.js.
 *
 * maxFieldChars is deliberately not the implementation default (2000), per
 * SPEC section 8.
 *
 * This file writes tests only; src/ is untouched.
 */

const cfg = { maxFieldChars: 40 };

const taskUrls = [
  // Bare-id form, from the v1 API documentation's example payload.
  'https://app.todoist.com/app/task/6XR4GqQQCW6Gv9h4',
  // Slugged title-derived form documented in D-5.
  'https://app.todoist.com/app/task/ar-xi-v-202403190000-202403192359-7814598409',
];

const projectUrls = [
  // Bare-id form.
  'https://app.todoist.com/app/project/6Jf8VQXxpwv56VQ7',
  // Slugged name-derived form, as built by Doist's TypeScript SDK
  // (getProjectUrl('67890', 'Work Project')).
  'https://app.todoist.com/app/project/work-project-67890',
];

for (const url of taskUrls) {
  test(`D-5: shapeTask emits no url key even when the input carries one — ${url}`, () => {
    const out = shapeTask({ id: '999', content: 'Buy milk', url }, cfg);
    assert.equal(Object.hasOwn(out, 'url'), false, `url key present: ${JSON.stringify(out.url)}`);
  });
}

for (const url of projectUrls) {
  test(`D-5: shapeProject emits no url key even when the input carries one — ${url}`, () => {
    const out = shapeProject({ id: '777', name: 'Work Project', url }, cfg);
    assert.equal(Object.hasOwn(out, 'url'), false, `url key present: ${JSON.stringify(out.url)}`);
  });
}

async function connect(serverCfg) {
  const { server } = createServer(serverCfg);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

for (const url of taskUrls) {
  test(`D-5: add-tasks echo carries no url key even when the created object has one — ${url}`, async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: '4242', content: 'Buy milk', url }),
    });
    try {
      const client = await connect({
        apiKey: 'd5-test-token-000000',
        readOnly: false,
        maxOutputChars: 12345,
        maxFieldChars: cfg.maxFieldChars,
        maxItems: 17,
      });
      const res = await client.callTool({
        name: 'add-tasks',
        arguments: { tasks: [{ content: 'Buy milk' }] },
      });
      await client.close();

      assert.ok(!res.isError, `add-tasks returned an error: ${res.content?.[0]?.text}`);
      const text = res.content.map((c) => c.text).join('\n');
      const prefix = `${UNTRUSTED_NOTICE}\n\n`;
      assert.ok(text.startsWith(prefix), 'fixture error: result does not start with the notice');
      const payload = JSON.parse(text.slice(prefix.length));

      // Guard: confirm this is the echo of the object the mock returned, so
      // the key check below is reading the right thing.
      const echoed = payload.tasks?.[0];
      assert.equal(echoed?.id, '4242', `fixture error: unexpected payload ${JSON.stringify(payload)}`);

      assert.equal(
        Object.hasOwn(echoed, 'url'),
        false,
        `url key present: ${JSON.stringify(echoed.url)}`
      );
    } finally {
      globalThis.fetch = orig;
    }
  });
}
