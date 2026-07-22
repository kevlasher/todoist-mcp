/**
 * Todoist API v1 HTTP client.
 *
 * Two proven patterns are reimplemented here (MadLlama25/fastmail-mcp as
 * reference, written clean for Todoist):
 *   - SSRF / base-URL allowlist: every outbound request is pinned to
 *     https://api.todoist.com. Any other host or scheme is rejected before a
 *     socket is opened.
 *   - Token redaction: the Authorization header is never logged; errors are
 *     routed through the redactor (see redact.js / logger.js).
 */
import { logger } from './logger.js';
import { redact } from './redact.js';

export const API_HOST = 'api.todoist.com';
export const API_BASE = `https://${API_HOST}/api/v1`;

/** Thrown for any request we refuse to make (SSRF allowlist violation). */
export class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SsrfError';
  }
}

/** Thrown when the Todoist API returns a non-2xx response. */
export class TodoistApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TodoistApiError';
    this.status = status;
  }
}

/**
 * Assert a URL targets the allowlisted host over HTTPS. Exported for testing.
 * Rejects everything that is not exactly https://api.todoist.com.
 */
export function assertAllowedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError('Refusing request: malformed URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new SsrfError(
      `Refusing request: only https is allowed (got ${parsed.protocol}).`
    );
  }
  if (parsed.hostname !== API_HOST) {
    throw new SsrfError(
      `Refusing request: host ${parsed.hostname} is not on the allowlist (only ${API_HOST}).`
    );
  }
  return parsed;
}

export function createClient(config) {
  const authHeader = `Bearer ${config.apiKey}`;

  /** Low-level request. path is relative to API_BASE; query is an object. */
  async function request(method, path, { query, body } = {}) {
    const url = new URL(API_BASE + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        url.searchParams.set(k, String(v));
      }
    }

    // SSRF allowlist — enforced on the fully-composed URL.
    assertAllowedUrl(url.toString());

    const headers = { Authorization: authHeader };
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    // Log the request WITHOUT the Authorization header or query values that
    // could echo the token; redact() is a further safety net.
    logger.info(`${method} ${path}`);

    let res;
    try {
      res = await fetch(url.toString(), { method, headers, body: payload });
    } catch (err) {
      throw new TodoistApiError(
        `Network error contacting Todoist: ${redact(err?.message ?? String(err))}`
      );
    }

    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        /* ignore body read failure */
      }
      throw new TodoistApiError(
        `Todoist API ${res.status} on ${method} ${path}: ${redact(detail).slice(0, 500)}`,
        res.status
      );
    }

    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /**
   * GET a paginated collection, following next_cursor until exhausted or until
   * maxItems is reached. Todoist v1 wraps lists as { results, next_cursor }.
   */
  async function getPaginated(path, query = {}, maxItems) {
    const cap = maxItems ?? config.maxItems;
    const items = [];
    let cursor;
    // The API caps limit at 200; ask for what we still need, bounded to 200.
    do {
      const pageLimit = Math.min(200, cap - items.length);
      if (pageLimit <= 0) break;
      const page = await request('GET', path, {
        query: { ...query, limit: pageLimit, cursor },
      });
      if (Array.isArray(page)) {
        // Some endpoints may return a bare array; no further pages.
        items.push(...page);
        break;
      }
      const results = page?.results ?? [];
      items.push(...results);
      cursor = page?.next_cursor ?? undefined;
    } while (cursor && items.length < cap);

    return { items: items.slice(0, cap), truncated: items.length >= cap && !!cursor };
  }

  return { request, getPaginated };
}
