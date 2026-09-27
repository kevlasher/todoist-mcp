/**
 * Configuration is derived ONCE from the environment at process startup.
 *
 * The read-only decision in particular is a launch-time decision, never a
 * runtime toggle: whichever subagent frontmatter launched this process decided
 * the mode, and nothing flips it mid-session.
 */
import { readFileSync as nodeReadFileSync } from 'node:fs';

function intFromEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/**
 * Read-only default is FAIL-SAFE: writes are enabled ONLY when TODOIST_READONLY
 * is exactly the string "false". Unset, empty, "true", "0", or any other value
 * all resolve to read-only. See README "Env-gated read-only mode".
 */
export function isReadOnly(env = process.env) {
  const raw = env.TODOIST_READONLY;
  return !(raw === 'false');
}

/**
 * Resolve the API token. Two sources, in priority order:
 *   1. TODOIST_API_KEY:        the token directly in the environment.
 *   2. TODOIST_API_KEY_FILE:   path to a file (0600, owned by the service
 *                              user) whose contents are the token. Preferred
 *                              for the deployed subagent so no token sits in
 *                              the committed agent file or a process listing.
 */
function resolveToken(env, readFileSync) {
  const direct = env.TODOIST_API_KEY;
  if (direct && direct.trim() !== '') return direct.trim();

  const file = env.TODOIST_API_KEY_FILE;
  if (file && file.trim() !== '') {
    let contents;
    try {
      contents = readFileSync(file.trim(), 'utf8');
    } catch {
      // Do not echo the path contents; a bad path is a config error.
      throw new Error(`TODOIST_API_KEY_FILE could not be read.`);
    }
    const token = contents.trim();
    if (token !== '') return token;
  }
  return '';
}

export function loadConfig(env = process.env, deps = {}) {
  const readFileSync = deps.readFileSync ?? nodeReadFileSync;
  const apiKey = resolveToken(env, readFileSync);
  if (!apiKey) {
    throw new Error(
      'TODOIST_API_KEY is not set. Provide the Todoist personal API token via ' +
        'TODOIST_API_KEY, or a path to a 0600 token file via TODOIST_API_KEY_FILE.'
    );
  }

  return {
    apiKey,
    readOnly: isReadOnly(env),
    // Total characters any single read tool may return (flood cap).
    maxOutputChars: intFromEnv(env, 'TODOIST_MAX_OUTPUT_CHARS', 50000),
    // Characters kept per individual untrusted text field before truncation.
    maxFieldChars: intFromEnv(env, 'TODOIST_MAX_FIELD_CHARS', 2000),
    // Items fetched across pagination for a single read call.
    maxItems: intFromEnv(env, 'TODOIST_MAX_ITEMS', 200),
  };
}
