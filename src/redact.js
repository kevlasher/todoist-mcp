/**
 * Token redaction (reimplemented from the MadLlama25/fastmail-mcp pattern).
 *
 * The Todoist API token is full-access and must NEVER appear in logs, error
 * messages, or any text that could reach agent context or disk. This module is
 * the single choke point: everything logged or thrown passes through redact().
 */

// Registered secrets to scrub. The live token is registered at startup.
const secrets = new Set();

/** Register a secret string to be scrubbed from all future output. */
export function registerSecret(value) {
  if (typeof value === 'string' && value.length >= 4) {
    secrets.add(value);
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scrub known secrets and any Bearer/Authorization material from a string.
 * Belt-and-suspenders: we redact both the exact registered token and any
 * token-shaped material following an Authorization/Bearer marker, so an
 * unregistered credential still can't leak.
 */
export function redact(input) {
  let text = typeof input === 'string' ? input : String(input);

  for (const secret of secrets) {
    text = text.replaceAll(secret, '[REDACTED]');
  }

  // Redact "Bearer <token>" regardless of registration.
  text = text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
  // Redact an Authorization header value however it's formatted.
  text = text.replace(
    /("?authorization"?\s*[:=]\s*)("?)[^\s"',}]+/gi,
    '$1$2[REDACTED]'
  );

  return text;
}

/**
 * The only place in src/ that cuts text (D-7). It redacts before it cuts, so
 * a cut can never split a secret into a fragment that redaction no longer
 * recognizes. Returns the redacted text, at most `cap` characters, and
 * whether it was cut. test/d7-error-result.test.js checks statically that no
 * other code in src/ cuts a string.
 */
export function redactThenCut(input, cap) {
  const text = redact(input);
  if (text.length <= cap) return { text, cut: false };
  return { text: text.slice(0, cap), cut: true };
}

/** Redact recursively through an Error (message + stack). Returns a plain object. */
export function redactError(err) {
  if (err instanceof Error) {
    return {
      message: redact(err.message),
      stack: err.stack ? redact(err.stack) : undefined,
    };
  }
  return { message: redact(err) };
}
