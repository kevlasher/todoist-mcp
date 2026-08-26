/**
 * The single result builder (Invariant 12).
 *
 * Every one of the sixteen tools — read or write, success or error — returns
 * whatever this function produces, and nothing else builds a `{ content: [...] }`
 * / `{ isError, content: [...] }` object anywhere in src/. Centralizing this is
 * what makes output-size capping and last-line-of-defense redaction apply
 * uniformly instead of depending on each tool file remembering to call them.
 *
 * Per-field sanitization of untrusted text (safeField/stripMarkup) still
 * happens where the payload is assembled (shape.js for read tools, inline in
 * write.js for echoed write fields) — this function does not know which
 * fields in an arbitrary payload are untrusted prose. What it guarantees
 * regardless of that is: every success payload is size-capped and framed with
 * the untrusted-content notice, every error message is redacted, and the wire
 * shape itself is built in exactly one place.
 */
import { capOutput, UNTRUSTED_NOTICE } from './sanitize.js';
import { redact } from './redact.js';

export function buildResult(cfg, { payload, error } = {}) {
  if (error !== undefined) {
    const message = redact(error instanceof Error ? error.message : String(error));
    return { isError: true, content: [{ type: 'text', text: `Error: ${message}` }] };
  }
  const body = capOutput(payload, cfg.maxOutputChars);
  const text = redact(`${UNTRUSTED_NOTICE}\n\n${body}`);
  return { content: [{ type: 'text', text }] };
}
