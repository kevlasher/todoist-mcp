#!/usr/bin/env node
/**
 * LIVE, TARGETED smoke test for the `find-tasks-by-date` tool.
 *
 * Unlike scripts/live-smoke.js (which exercises the plain /tasks list via
 * find-tasks), this script proves the date path, which routes through the
 * unified API's dedicated filter endpoint /api/v1/tasks/filter — a DISTINCT
 * endpoint from /tasks. A passing find-tasks smoke test does not prove this.
 *
 * It runs only against the verified contract test account, as
 * scripts/live-smoke.js does: the account guard is checked before anything
 * else, and every later call uses the same contract-test token that guard
 * just verified, never TODOIST_API_KEY or TODOIST_API_KEY_FILE. It must run in
 * READ/WRITE mode (TODOIST_READONLY=false). It sets up and tears down its own
 * throwaway task, leaving no active residue.
 *
 * Usage:
 *   TODOIST_CONTRACT_TEST_TOKEN=xxxxx TODOIST_CONTRACT_TEST_ACCOUNT_ID=yyyyy \
 *     TODOIST_READONLY=false node scripts/live-smoke-date.js
 *
 * There is no environment variable, flag, or argument that skips the account
 * guard.
 *
 * It does NOT modify any src/ code. It observes the real wire URL by wrapping
 * globalThis.fetch (the same seam the offline tests use), passing every logged
 * URL through the project's existing redaction path so the token can't leak.
 */
import { verifyContractTestAccount } from '../test-contract/account-guard.js';
import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server.js';
import { registerSecret, redact } from '../src/redact.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Every date filter the tool exposes via `preset`.
const PRESETS = ['today', 'overdue', 'next7days', 'nodate', 'recurring'];

function textOf(res) {
  return (res.content ?? []).map((c) => c.text).join('\n');
}

// Both read and write tool results carry JSON; read results prefix it with a
// plain-text UNTRUSTED notice (which contains no `{`), so slicing from the
// first brace yields the JSON payload in either case.
function parseBody(text) {
  const i = text.indexOf('{');
  if (i === -1) return null;
  try {
    return JSON.parse(text.slice(i));
  } catch {
    return null;
  }
}

async function main() {
  // Account guard first, before loadConfig, before any Todoist request.
  // Throws (and makes no other request) if the token is missing or does
  // not belong to the expected contract test account.
  const account = await verifyContractTestAccount();
  console.log(`Verified contract test account: id ${account.id}`);

  // Use the contract-test token for everything below, not TODOIST_API_KEY.
  // Both real-environment token inputs are stripped before loadConfig sees
  // this env, so the account verified above is the only one this script can
  // reach, whatever config.js's token priority rule says.
  const smokeEnv = { ...process.env, TODOIST_API_KEY: process.env.TODOIST_CONTRACT_TEST_TOKEN };
  delete smokeEnv.TODOIST_API_KEY_FILE;
  const cfg = loadConfig(smokeEnv);
  if (cfg.readOnly) {
    console.error(
      'Refusing to run: this test writes a throwaway task, so it needs TODOIST_READONLY=false.'
    );
    process.exit(2);
  }
  registerSecret(cfg.apiKey);

  // ---- wire-level request recorder (redacted) -----------------------------
  // Wraps global fetch WITHOUT touching src/. Records the real URL, method and
  // status of every outbound call so we can show definitively which endpoint
  // each filter hits.
  const wire = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const rec = { method: opts.method ?? 'GET', url: redact(String(url)), status: null };
    wire.push(rec);
    const res = await realFetch(url, opts);
    rec.status = res.status;
    return res;
  };

  const { server, toolNames } = createServer(cfg);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'smoke-date', version: '1.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  console.log(`Registered tools: ${toolNames.length} (${cfg.readOnly ? 'READ-ONLY' : 'READ/WRITE'})\n`);

  const failures = [];
  const marker = `SMOKE-TEST-DATE ${new Date().toISOString()}`;
  const today = new Date().toISOString().slice(0, 10);
  const perFilter = {};
  let taskId = null;
  let foundToday = false;

  try {
    // 1) create a throwaway task due TODAY -----------------------------------
    console.log(`1) add-tasks -> "${marker}"  (due_date=${today})`);
    const startAdd = wire.length;
    const added = await client.callTool({
      name: 'add-tasks',
      arguments: { tasks: [{ content: marker, due_date: today, priority: 1 }] },
    });
    for (const r of wire.slice(startAdd)) console.log(`     ${r.method} ${r.url} -> ${r.status}`);
    if (added.isError) {
      failures.push({ step: 'setup:add-tasks', error: textOf(added) });
      throw new Error(`Setup failed (add-tasks): ${textOf(added)}`);
    }
    taskId = parseBody(textOf(added))?.tasks?.[0]?.id ?? null;
    console.log(`     created task id: ${taskId}\n`);
    if (!taskId) throw new Error('add-tasks returned no task id; cannot continue.');

    // 2) call find-tasks-by-date for each preset -----------------------------
    PRESETS.forEach((p, idx) => void idx); // keep lint happy about index below
    let idx = 0;
    for (const preset of PRESETS) {
      idx += 1;
      const start = wire.length;
      const res = await client.callTool({
        name: 'find-tasks-by-date',
        arguments: { preset },
      });
      const reqs = wire.slice(start);
      const body = res.isError ? null : parseBody(textOf(res));

      console.log(`2.${idx}) find-tasks-by-date preset="${preset}"`);
      for (const r of reqs) console.log(`     ${r.method} ${r.url} -> ${r.status}`);

      // Surface any non-2xx status seen on the wire.
      for (const r of reqs) {
        if (r.status !== null && (r.status < 200 || r.status >= 300)) {
          failures.push({ step: `filter:${preset}`, status: r.status, url: r.url });
        }
      }

      if (res.isError) {
        // The tool error text already carries the HTTP status + redacted body.
        console.log(`     ERROR (not swallowed): ${textOf(res)}`);
        failures.push({ step: `filter:${preset}`, error: textOf(res) });
      } else {
        console.log(`     filter query built: "${body?.filter}"   result count: ${body?.count}`);
      }

      const ids = body?.tasks?.map((t) => t.id) ?? [];
      if (preset === 'today' && ids.includes(taskId)) foundToday = true;

      perFilter[preset] = {
        endpoints: reqs.map((r) => ({ method: r.method, url: r.url, status: r.status })),
        count: body?.count ?? null,
        filter: body?.filter ?? null,
        isError: !!res.isError,
      };
      console.log('');
    }

    // 3) confirm the today-due task showed up in the "today" filter ----------
    console.log(`3) today-due task ${taskId} present in "today" result: ${foundToday ? 'YES' : 'NO'}`);
    if (!foundToday) {
      failures.push({
        step: 'confirm:today',
        note: 'throwaway task did not appear in the "today" filter result (note: bounded to the item cap; a very large today|overdue list could push it off the page)',
      });
    }
    console.log('');
  } finally {
    // 4) cleanup — always runs so no active residue is left ------------------
    if (taskId) {
      console.log(`4) cleanup: complete-tasks [${taskId}]`);
      try {
        const startC = wire.length;
        const done = await client.callTool({ name: 'complete-tasks', arguments: { ids: [taskId] } });
        for (const r of wire.slice(startC)) console.log(`     ${r.method} ${r.url} -> ${r.status}`);
        if (done.isError) {
          console.log(`     cleanup FAILED (not swallowed): ${textOf(done)}`);
          failures.push({ step: 'cleanup:complete', error: textOf(done) });
        } else {
          // Verify the task is no longer among ACTIVE tasks.
          const check = await client.callTool({ name: 'find-tasks', arguments: { ids: [taskId] } });
          const residue = check.isError ? '?' : parseBody(textOf(check))?.count;
          console.log(`     completed OK; active tasks with that id now: ${residue}`);
          if (residue !== 0) {
            failures.push({ step: 'cleanup:verify', note: `expected 0 active, got ${residue}` });
          } else {
            console.log(
              '     (the task remains in Todoist completed-history; there is no delete tool by design — remove it manually if desired)'
            );
          }
        }
      } catch (e) {
        console.log(`     cleanup threw: ${redact(e.message)}`);
        failures.push({ step: 'cleanup', error: redact(e.message) });
      }
    } else {
      console.log('4) cleanup: nothing to clean up (no task was created).');
    }
    await client.close();
  }

  // ---- report -------------------------------------------------------------
  console.log('\n================ SUMMARY ================');
  console.log('Endpoint hit per filter (result count):');
  for (const p of PRESETS) {
    const e = perFilter[p];
    if (!e) {
      console.log(`  ${p.padEnd(9)}: (not reached)`);
      continue;
    }
    const eps = e.endpoints.map((x) => `${x.method} ${new URL(x.url).pathname} -> ${x.status}`).join(', ');
    console.log(`  ${p.padEnd(9)}: ${eps}  | count=${e.count}${e.isError ? '  [ERROR]' : ''}`);
  }
  console.log(`\nToday-due task found in "today": ${foundToday ? 'YES' : 'NO'}`);
  console.log(`Cleanup: ${taskId ? 'attempted (see above)' : 'n/a'}`);
  if (failures.length === 0) {
    console.log('\nRESULT: PASS — every filter routed to /api/v1/tasks/filter with a 2xx, task found and cleaned up.');
    process.exit(0);
  } else {
    console.log(`\nRESULT: FAIL — ${failures.length} issue(s):`);
    for (const f of failures) console.log('  -', JSON.stringify(f));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Live date smoke test FAILED to run:', redact(err?.message ?? String(err)));
  process.exit(1);
});
