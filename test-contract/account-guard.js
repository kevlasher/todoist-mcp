/**
 * Contract-test account guard: standalone, no imports from src/.
 *
 * Confirms TODOIST_CONTRACT_TEST_TOKEN belongs to the expected throwaway
 * account (TODOIST_CONTRACT_TEST_ACCOUNT_ID) before any contract test is
 * allowed to run a real write against it.
 *
 * GET /api/v1/user returns live credentials in `token` and `websocket_url`.
 * This module reads only `id` and `email` off that response and must never
 * let the rest of the body reach a log line, thrown message, or return
 * value, including on error paths. No logger is used here; nothing in
 * this file writes to stdout/stderr on its own.
 *
 * The token must reach no message either (D-21). The guard refuses a token
 * containing any character outside printable ASCII before any request,
 * because fetch's header check quotes the whole header value, token
 * included, when it rejects one. Every request in test-contract/ and
 * scripts/ goes through fetchWithFixedError, so no other error can carry
 * it out either.
 */

const USER_URL = 'https://api.todoist.com/api/v1/user';
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/**
 * Send a request, and replace any error it throws with fixed text: a
 * network or header error can quote the Authorization header. `send` lets
 * a caller that has replaced globalThis.fetch pass the original. The catch
 * binds nothing, so the original error cannot reach a message or a cause.
 * test/d21-token-header-error.test.js checks this body's form and that no
 * file in test-contract/ or scripts/ calls fetch any other way.
 */
export async function fetchWithFixedError(url, init, send = fetch) {
  try {
    return await send(url, init);
  } catch {
    throw new Error('Request to Todoist failed before a response arrived; the error is withheld because it can contain the token.');
  }
}

export async function verifyContractTestAccount() {
  const token = process.env.TODOIST_CONTRACT_TEST_TOKEN;
  const expectedId = process.env.TODOIST_CONTRACT_TEST_ACCOUNT_ID;

  if (!token || !expectedId) {
    throw new Error(
      'TODOIST_CONTRACT_TEST_TOKEN and TODOIST_CONTRACT_TEST_ACCOUNT_ID must both be set.'
    );
  }

  if (!PRINTABLE_ASCII.test(token)) {
    throw new Error(
      'TODOIST_CONTRACT_TEST_TOKEN contains a character outside printable ASCII; refusing to send it.'
    );
  }

  const res = await fetchWithFixedError(USER_URL, {
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
