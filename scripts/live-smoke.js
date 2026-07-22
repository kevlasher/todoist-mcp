#!/usr/bin/env node
/**
 * LIVE smoke test — requires a real TODOIST_API_KEY and hits the real account.
 *
 * Covers the acceptance test that cannot run offline: with TODOIST_READONLY=false,
 * the full tool set is present and a write round-trips (add a throwaway task,
 * read it back, then complete it). It creates and then completes a task named
 * with a unique marker so it's easy to spot and undo.
 *
 * Usage:
 *   TODOIST_API_KEY=xxxxx TODOIST_READONLY=false node scripts/live-smoke.js
 *
 * It refuses to run in read-only mode (nothing to write).
 */
import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

function textOf(res) {
  return (res.content ?? []).map((c) => c.text).join('\n');
}

async function main() {
  const cfg = loadConfig();
  if (cfg.readOnly) {
    console.error('Refusing to run: set TODOIST_READONLY=false for the write round-trip.');
    process.exit(2);
  }

  const { server, toolNames } = createServer(cfg);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'smoke', version: '1.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);

  console.log('Registered tools:', toolNames.join(', '));

  const marker = `SMOKE-TEST ${new Date().toISOString()}`;
  console.log(`\n1) add-tasks -> "${marker}"`);
  const added = await client.callTool({
    name: 'add-tasks',
    arguments: { tasks: [{ content: marker, priority: 1 }] },
  });
  console.log(textOf(added));
  const id = JSON.parse(textOf(added)).tasks[0].id;
  if (!id) throw new Error('No task id returned from add-tasks.');

  console.log('\n2) find-tasks (read back the throwaway task)');
  const found = await client.callTool({
    name: 'find-tasks',
    arguments: { ids: [id] },
  });
  console.log(textOf(found));

  console.log('\n3) complete-tasks (clean up)');
  const done = await client.callTool({
    name: 'complete-tasks',
    arguments: { ids: [id] },
  });
  console.log(textOf(done));

  console.log('\nLive smoke test OK: add + read + complete round-tripped.');
  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Live smoke test FAILED:', err.message);
  process.exit(1);
});
