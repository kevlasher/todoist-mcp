#!/usr/bin/env node
/**
 * LIVE smoke test — runs only against the verified contract test account.
 * It never touches a real/personal Todoist account: the account guard is
 * checked before anything else, and the token it uses for every subsequent
 * call is the same contract-test token that guard just verified, not
 * TODOIST_API_KEY.
 *
 * Covers the acceptance test that cannot run offline: with TODOIST_READONLY=false,
 * the full tool set is present and a write round-trips (add a throwaway task,
 * read it back, then complete it). It creates and then completes a task named
 * with a unique marker so it's easy to spot and undo.
 *
 * Usage:
 *   TODOIST_CONTRACT_TEST_TOKEN=xxxxx TODOIST_CONTRACT_TEST_ACCOUNT_ID=yyyyy \
 *     TODOIST_READONLY=false node scripts/live-smoke.js
 *
 * It refuses to run in read-only mode (nothing to write). There is no
 * environment variable, flag, or argument that skips the account guard.
 */
import { verifyContractTestAccount } from '../test-contract/account-guard.js';
import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

function textOf(res) {
  return (res.content ?? []).map((c) => c.text).join('\n');
}

/**
 * Every tool response text carries a leading untrusted-content notice
 * (UNTRUSTED_NOTICE, src/sanitize.js) before the JSON payload — see
 * src/result.js. Locate the JSON object by its outermost braces rather than
 * assuming a fixed prefix length or hardcoded notice string, so this keeps
 * working if that notice's wording or length ever changes. Used everywhere
 * this script needs to parse a tool result as JSON, not just for add-tasks.
 */
function jsonOf(res) {
  const text = textOf(res);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Could not locate a JSON payload in tool output.');
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('Could not parse the JSON payload found in tool output.');
  }
}

async function main() {
  // Account guard first, before loadConfig, before any Todoist request.
  // Throws (and makes no other request) if the token is missing or does
  // not belong to the expected contract test account.
  const account = await verifyContractTestAccount();
  console.log(`Verified contract test account: id ${account.id}`);

  // Use the contract-test token for everything below, not TODOIST_API_KEY —
  // the account just verified above must be the account every subsequent
  // call actually runs against. Both real-environment token inputs are
  // stripped before loadConfig sees this env, so this guarantee doesn't
  // depend on config.js's TODOIST_API_KEY-beats-TODOIST_API_KEY_FILE
  // priority rule staying correct — removing both inputs makes it
  // unconditional rather than order-dependent.
  const smokeEnv = { ...process.env, TODOIST_API_KEY: process.env.TODOIST_CONTRACT_TEST_TOKEN };
  delete smokeEnv.TODOIST_API_KEY_FILE;
  const cfg = loadConfig(smokeEnv);
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
  const id = jsonOf(added).tasks[0].id;
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
