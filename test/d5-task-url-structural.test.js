import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeTask } from '../src/shape.js';
import { safeField, FRAME_OPEN, FRAME_CLOSE } from '../src/sanitize.js';

/**
 * D-5 (docs/SPEC.md section 10): shapeTask passes `url` through raw, on the
 * assumption that Todoist builds it from the task id alone. Fix criteria
 * (strict, DECIDED Session 10): a url that is exactly
 * https://app.todoist.com/app/task/ followed by one or more ASCII letters
 * or digits, and nothing else, passes through intact. Anything else (other
 * scheme, userinfo, port, query, fragment, trailing slash or further path)
 * is routed through safeField like every other untrusted value.
 *
 * maxFieldChars is deliberately NOT the implementation default (2000), per
 * SPEC section 8: a fixture equal to the fallback cannot detect the cap
 * being dropped. It is also shorter than the slugged url below, so the
 * expected framed value is truncated and a fix that calls safeField without
 * the configured cap produces a different string.
 *
 * This file writes tests only; src/ is untouched.
 */

const cfg = { maxFieldChars: 40 };

function taskWithUrl(url) {
  return { id: '999', content: 'Buy milk', url };
}

// ---------------------------------------------------------------------------
// a. Structural urls survive intact.
//
// EXPECTED TO PASS BEFORE THE FIX EXISTS. This is not a stop-and-report
// event: today's raw passthrough already preserves these urls. These cases
// are a regression guard, the same role
// test/invariant4-todoist-allowlist.test.js plays, and exist to prove the
// matching branch of the fix does not alter today's behavior.
// ---------------------------------------------------------------------------

const structuralUrls = [
  // The v1 API documentation's example payload.
  'https://app.todoist.com/app/task/6XR4GqQQCW6Gv9h4',
  // Numeric id form, as used in invariant4-todoist-allowlist.test.js.
  'https://app.todoist.com/app/task/12345',
];

for (const url of structuralUrls) {
  test(`D-5 (a): structural task url survives shapeTask intact — ${url}`, () => {
    const out = shapeTask(taskWithUrl(url), cfg);
    assert.equal(out.url, url);
  });
}

// ---------------------------------------------------------------------------
// b. Non-structural urls come back framed exactly as safeField frames them.
//
// EXPECTED TO FAIL BEFORE THE FIX EXISTS, on the equality assertion: today
// shapeTask returns every url raw.
// ---------------------------------------------------------------------------

const nonStructuralUrls = [
  {
    name: 'slugged title-derived form documented in D-5',
    url: 'https://app.todoist.com/app/task/ar-xi-v-202403190000-202403192359-7814598409',
  },
  {
    name: 'legacy query-string form',
    url: 'https://todoist.com/showTask?id=999',
  },
  {
    name: 'correct path on an attacker-controlled host',
    url: 'https://app.todoist.com.evil.example/app/task/6XR4GqQQCW6Gv9h4',
  },
  {
    name: 'structural id followed by a further path segment',
    url: 'https://app.todoist.com/app/task/6XR4GqQQCW6Gv9h4/extra',
  },
  {
    name: 'structural id followed by a query string',
    url: 'https://app.todoist.com/app/task/6XR4GqQQCW6Gv9h4?next=evil',
  },
  {
    name: 'http scheme instead of https',
    url: 'http://app.todoist.com/app/task/6XR4GqQQCW6Gv9h4',
  },
  {
    name: 'userinfo before the correct host',
    url: 'https://attacker@app.todoist.com/app/task/6XR4GqQQCW6Gv9h4',
  },
  {
    // The default port on purpose: a check built on new URL() normalizes
    // :443 away and would wrongly accept this. The decision is on the string.
    name: 'explicit port, even the https default',
    url: 'https://app.todoist.com:443/app/task/6XR4GqQQCW6Gv9h4',
  },
  {
    name: 'structural id followed by a fragment',
    url: 'https://app.todoist.com/app/task/6XR4GqQQCW6Gv9h4#frag',
  },
  {
    name: 'structural id followed by a trailing slash',
    url: 'https://app.todoist.com/app/task/6XR4GqQQCW6Gv9h4/',
  },
];

for (const { name, url } of nonStructuralUrls) {
  test(`D-5 (b): non-structural task url comes back framed by safeField — ${name}`, () => {
    const expected = safeField(url, cfg.maxFieldChars);

    // Guard against a vacuous comparison: the expected value must be a
    // framed string distinct from the raw url, or equality proves nothing.
    assert.ok(
      expected.startsWith(FRAME_OPEN) && expected.endsWith(FRAME_CLOSE),
      `fixture error: safeField did not frame ${url}`
    );
    assert.notEqual(expected, url, `fixture error: safeField returned ${url} unchanged`);

    const out = shapeTask(taskWithUrl(url), cfg);
    assert.equal(out.url, expected);
  });
}
