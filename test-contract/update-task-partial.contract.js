#!/usr/bin/env node
/**
 * Contract test: POST /tasks/{id} partial-update semantics.
 *
 * Verifies, against the live Todoist API, the premise behind security
 * review Finding 1 / SPEC.md Invariant discussion: that update-tasks sends
 * only caller-supplied fields, and that the API responds with full current
 * task state (including fields the request never sent), not just an echo
 * of what was sent.
 *
 * Not collected by `npm test`, which runs only test/*.test.js (this file
 * lives outside test/, and its name doesn't match that pattern anyway). Run
 * directly:
 *
 *   TODOIST_CONTRACT_TEST_TOKEN=xxx TODOIST_CONTRACT_TEST_ACCOUNT_ID=yyy \
 *     node test-contract/update-task-partial.contract.js
 *
 * Per docs/SPEC.md section 9, the request-body verification below (step 2)
 * is the mandatory substitute-for-failure-first check for this contract
 * test: it proves the update request itself carries only `priority`, so
 * the API echoing back `content` under step 5 can't be explained by the
 * request having sent `content` in the first place.
 */
import { fetchWithFixedError, verifyContractTestAccount } from './account-guard.js';

const API_BASE = 'https://api.todoist.com/api/v1';

async function main() {
  // Step 1: account guard first, unconditionally. If this throws, nothing
  // below runs and no other request is ever made.
  const account = await verifyContractTestAccount();
  console.log(`Verified contract test account: id ${account.id}`);

  const token = process.env.TODOIST_CONTRACT_TEST_TOKEN;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Step 2: build the update body and verify its shape BEFORE sending
  // anything. Must contain exactly 'priority' and nothing else,
  // in particular, not 'content'.
  const updateBody = { priority: 4 };
  const updateKeys = Object.keys(updateBody);
  if (updateKeys.length !== 1 || updateKeys[0] !== 'priority') {
    throw new Error(
      `request-body verification failed: expected exactly ['priority'], got [${updateKeys.join(', ')}]`
    );
  }
  if (Object.prototype.hasOwnProperty.call(updateBody, 'content')) {
    throw new Error('request-body verification failed: body must not contain content');
  }
  console.log(`Verified outgoing update body keys: [${updateKeys.join(', ')}]`);

  const marker = `CONTRACT-TEST ${new Date().toISOString()}`;
  let taskId;

  try {
    // Step 3: create a throwaway task.
    const createRes = await fetchWithFixedError(`${API_BASE}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: marker, priority: 1 }),
    });
    if (!createRes.ok) {
      throw new Error(`task creation failed: status ${createRes.status}`);
    }
    const created = await createRes.json();
    taskId = created.id;
    if (!taskId) {
      throw new Error('task creation returned no id');
    }
    console.log(`Created task ${taskId}`);

    // Step 4: send the verified body as the entire JSON body of the update.
    const updateRes = await fetchWithFixedError(`${API_BASE}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(updateBody),
    });
    if (!updateRes.ok) {
      throw new Error(`update request failed: status ${updateRes.status}`);
    }
    const updated = await updateRes.json();
    const updateResponseKeys = Object.keys(updated);
    const sentKeys = new Set(updateKeys);
    const extraKeys = updateResponseKeys.filter((k) => !sentKeys.has(k));

    // Step 6: print the observation, pass or fail.
    console.log(`Update response top-level fields: [${updateResponseKeys.join(', ')}]`);
    console.log(`content: ${JSON.stringify(updated.content)}`);
    console.log(
      `Fields returned that the request did not send: [${extraKeys.join(', ') || '(none)'}]`
    );

    // Step 5: assertions.
    const failures = [];
    if (!Object.prototype.hasOwnProperty.call(updated, 'content')) {
      failures.push("response missing 'content' field");
    } else if (updated.content !== marker) {
      failures.push(`content mismatch: expected ${JSON.stringify(marker)}, got ${JSON.stringify(updated.content)}`);
    }
    if (extraKeys.length === 0) {
      failures.push(
        'response contained no fields beyond what was sent; expected untouched fields (e.g. content) to come back too'
      );
    }
    if (updated.priority !== updateBody.priority) {
      failures.push(`priority mismatch: expected ${updateBody.priority}, got ${updated.priority}`);
    }

    if (failures.length > 0) {
      throw new Error(failures.join('; '));
    }

    console.log('PASS: POST /tasks/{id} is a partial update that returns full current task state.');
    process.exitCode = 0;
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    process.exitCode = 1;
  } finally {
    // Step 7: cleanup always runs, even on assertion failure.
    if (taskId) {
      try {
        const delRes = await fetchWithFixedError(`${API_BASE}/tasks/${encodeURIComponent(taskId)}`, {
          method: 'DELETE',
          headers,
        });
        if (!delRes.ok) {
          console.log(`CLEANUP FAILED (status ${delRes.status});  remove task ${taskId} by hand.`);
        } else {
          console.log(`Cleaned up task ${taskId}.`);
        }
      } catch {
        console.log(`CLEANUP FAILED (network error);  remove task ${taskId} by hand.`);
      }
    }
  }
}

main().catch((err) => {
  // Only reachable for failures before task creation (account guard,
  // request-body verification); nothing to clean up in that case.
  console.log(`FAIL: ${err.message}`);
  process.exitCode = 1;
});
