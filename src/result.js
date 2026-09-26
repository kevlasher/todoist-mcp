/**
 * The single result builder (Invariant 12).
 *
 * Every one of the sixteen tools — read or write, success or error — returns
 * whatever this function produces, and nothing else builds a `{ content: [...] }`
 * / `{ isError, content: [...] }` object anywhere in src/. Centralizing this is
 * what makes output-size capping, the untrusted-content notice and
 * last-line-of-defense redaction apply uniformly instead of depending on each
 * tool file remembering to call them.
 *
 * Per-field sanitization of untrusted text (safeField/stripMarkup) still
 * happens where a success payload is assembled (shape.js for read tools,
 * inline in write.js for echoed write fields) — this function does not know
 * which fields in an arbitrary payload are untrusted prose. An error message
 * is one field, and it can carry upstream text, so this function passes it
 * through safeField itself (D-7). What it guarantees regardless is: every
 * result, success or error, is size-capped, carries the untrusted-content
 * notice (AD-4) and is redacted before any cut and again as the last step,
 * and the wire shape itself is built in exactly one place.
 */
import { capOutput, safeField, UNTRUSTED_NOTICE } from './sanitize.js';
import { redact } from './redact.js';

export function buildResult(cfg, { payload, error } = {}) {
  const isError = error !== undefined;
  const body = isError
    ? capOutput(
        `Error: ${safeField(error instanceof Error ? error.message : String(error), cfg.maxFieldChars)}`,
        cfg.maxOutputChars
      )
    : capOutput(payload, cfg.maxOutputChars);
  const text = redact(`${UNTRUSTED_NOTICE}\n\n${body}`);
  if (isError) return { isError: true, content: [{ type: 'text', text }] };
  return { content: [{ type: 'text', text }] };
}
