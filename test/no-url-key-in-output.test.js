import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_ROOT = path.join(__dirname, '..', 'src');

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Bug class D-5 (docs/SPEC.md section 10): a `url` key in an object literal
// that becomes tool output. Deliberately narrow: it matches the key `url`
// written as `url:`, `'url':` or `"url":`, and nothing else. The lookbehind
// keeps it off member reads such as `t.url` or `created?.url`, and off
// longer names such as `file_url:`. Shorthand `{ url }`, computed keys and
// spreads of raw API objects are not caught; none exist in the scanned files
// today.
const URL_KEY = /(?<![\w$.])(['"]?)url\1\s*:/g;

function findUrlKeySites(source) {
  const sites = [];
  let m;
  while ((m = URL_KEY.exec(source))) {
    const line = source.slice(0, m.index).split('\n').length;
    const text = source.split('\n')[line - 1].trim();
    sites.push({ line, text });
  }
  return sites;
}

test('no object literal in src/shape.js or src/tools/ emits a url key', () => {
  const files = [
    path.join(SRC_ROOT, 'shape.js'),
    ...listJsFiles(path.join(SRC_ROOT, 'tools')),
  ];

  const offenses = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const site of findUrlKeySites(source)) {
      offenses.push(`  ${path.relative(path.join(SRC_ROOT, '..'), file)}:${site.line}  ${site.text}`);
    }
  }

  const explanation =
    'D-5 decision: the url field is removed from tool output entirely. Todoist builds ' +
    'task and project urls from the task title or project name, which are attacker-' +
    'writable, and a url is the one value that would otherwise reach the agent unframed ' +
    'and clickable. Do not add a url key to any shaper or handler echo.';

  assert.equal(
    offenses.length,
    0,
    `Found url key(s) in tool output. ${explanation}\n${offenses.join('\n')}`
  );
});
