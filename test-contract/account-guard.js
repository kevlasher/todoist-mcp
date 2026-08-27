/**
 * Contract-test account guard — standalone, no imports from src/.
 *
 * Confirms TODOIST_CONTRACT_TEST_TOKEN belongs to the expected throwaway
 * account (TODOIST_CONTRACT_TEST_ACCOUNT_ID) before any contract test is
 * allowed to run a real write against it.
 *
 * GET /api/v1/user returns live credentials in `token` and `websocket_url`.
 * This module reads only `id` and `email` off that response and must never
 * let the rest of the body reach a log line, thrown message, or return
 * value — including on error paths. No logger is used here; nothing in
 * this file writes to stdout/stderr on its own.
 */

const USER_URL = 'https://api.todoist.com/api/v1/user';

export async function verifyContractTestAccount() {
  const token = process.env.TODOIST_CONTRACT_TEST_TOKEN;
  const expectedId = process.env.TODOIST_CONTRACT_TEST_ACCOUNT_ID;

  if (!token || !expectedId) {
    throw new Error(
      'TODOIST_CONTRACT_TEST_TOKEN and TODOIST_CONTRACT_TEST_ACCOUNT_ID must both be set.'
    );
  }

  const res = await fetch(USER_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status !== 200) {
    throw new Error(`Contract test account check failed: status ${res.status}.`);
  }

  let parsed;
  try {
    parsed = await res.json();
  } catch {
    throw new Error('Contract test account check failed: response was not valid JSON.');
  }
  const { id, email } = parsed;

  if (typeof id !== 'string' && typeof id !== 'number') {
    throw new Error(
      'Contract test account check failed: user response contained no usable id field.'
    );
  }

  if (String(id) !== String(expectedId)) {
    throw new Error(
      `Contract test account mismatch: expected id ${expectedId}, got id ${id} (email ${email}).`
    );
  }

  return { id, email };
}
