import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripMarkup, safeField } from '../src/sanitize.js';

/**
 * SPEC.md Invariant 4: no tool output contains a URL in re-parseable or
 * clickable form, regardless of the syntax used to embed it in the source
 * text. stripMarkup satisfies this by defanging (not deleting) URL-shaped
 * text uniformly across every host: breaking the scheme and every dot. The
 * assertion helper below deliberately does not check that the URL text is
 * *absent* (under defanging the host text remains, just broken); it checks
 * that no *live* scheme or dotted host is reconstructable, in any form:
 * as a literal substring, after collapsing whitespace/newlines (catching a
 * link a downstream renderer would rejoin from a soft line-wrap), or as a
 * decimal/hex numeric-entity-encoded scheme+colon. Each check still fails
 * if the URL comes through live.
 */

const HOST = 'evil.example';
const PATH = '/payload';
const URL = `http://${HOST}${PATH}`;

function assertNoReparseableUrl(output, label) {
  assert.ok(
    !/https?:\/\//i.test(output),
    `${label}: raw "http(s)://" scheme survived in output: ${JSON.stringify(output)}`
  );

  const collapsed = output.replace(/[\r\n\t ]+/g, '');
  assert.ok(
    !/https?:\/\//i.test(collapsed),
    `${label}: "http(s)://" scheme reconstructable after collapsing whitespace/newlines: ${JSON.stringify(collapsed)}`
  );

  assert.ok(
    !new RegExp(HOST.replace('.', '\\.') + '/').test(collapsed),
    `${label}: target host+path reconstructable after collapsing whitespace: ${JSON.stringify(collapsed)}`
  );

  // Decimal (&#58;) and hex (&#x3A;) numeric-entity-encoded colon, in case
  // the scheme survives with only the colon substituted.
  assert.ok(
    !/https?&#0*58;\s*\/\//i.test(output),
    `${label}: decimal-entity-encoded scheme colon survived: ${JSON.stringify(output)}`
  );
  assert.ok(
    !/https?&#x0*3a;\s*\/\//i.test(output),
    `${label}: hex-entity-encoded scheme colon survived: ${JSON.stringify(output)}`
  );
}

const cases = [
  {
    name: 'inline markdown link',
    input: `Click [here](${URL}) for details.`,
  },
  {
    name: 'reference-style markdown link (label + separate definition line)',
    input: `See [here][1] for details.\n\n[1]: ${URL}`,
  },
  {
    name: 'bare URL with no markdown syntax',
    input: `Check this out: ${URL} thanks`,
  },
  {
    name: 'URL inside an HTML anchor tag',
    input: `<a href="${URL}">click</a>`,
  },
  {
    name: 'autolink angle-bracket form',
    input: `See <${URL}> for details.`,
  },
  {
    name: 'URL with numeric HTML entity substituted for the colon',
    input: `http&#58;//${HOST}${PATH}`,
  },
  {
    name: 'URL split across a line break',
    // Split mid-path with no space, as a soft line-wrap a renderer would
    // rejoin: "http://evil.example/pay" + "\n" + "load"
    input: `http://${HOST}/pay\nload`,
  },
];

for (const { name, input } of cases) {
  test(`stripMarkup: no re-parseable URL survives: ${name}`, () => {
    const out = stripMarkup(input);
    assertNoReparseableUrl(out, name);
  });

  test(`safeField (tool-output path): no re-parseable URL survives: ${name}`, () => {
    const out = safeField(input);
    assertNoReparseableUrl(out, name);
  });
}

test('numeric HTML entities are decoded before tag-stripping: decimal (&#60; / &#62;)', () => {
  const out = stripMarkup('&#60;script&#62;alert(1)&#60;/script&#62;');
  assert.ok(
    !out.includes('<script>'),
    `decoded tag survived tag-stripping: ${JSON.stringify(out)}`
  );
  assert.ok(
    !/&#0*60;|&#0*62;/.test(out),
    `raw decimal entity survived, leaving an inert-looking string a downstream renderer could decode into a live tag: ${JSON.stringify(out)}`
  );
});

test('numeric HTML entities are decoded before tag-stripping: hexadecimal (&#x3C; / &#x3E;)', () => {
  const out = stripMarkup('&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;');
  assert.ok(
    !out.includes('<script>'),
    `decoded tag survived tag-stripping: ${JSON.stringify(out)}`
  );
  assert.ok(
    !/&#x0*3c;|&#x0*3e;/i.test(out),
    `raw hex entity survived, leaving an inert-looking string a downstream renderer could decode into a live tag: ${JSON.stringify(out)}`
  );
});
