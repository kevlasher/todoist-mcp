import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

/**
 * Detect the SHAPE of an MCP tool result object literal — an object with a
 * `content` array whose element(s) declare `type: 'text'` — rather than
 * matching a literal function name like `readResult`/`writeResult`. This is
 * the wire shape every one of the sixteen tools must return (success or
 * `isError`), per Invariant 12. A regex, not an AST parse, but scoped tightly
 * enough (content-array-of-typed-text-object) that it should not fire on
 * unrelated object literals, while still catching a differently-named or
 * differently-shaped ad hoc builder introduced later.
 */
function findResultShapeSites(source) {
  const sites = [];
  const contentArrayRe = /content\s*:\s*\[\s*\{/g;
  let m;
  while ((m = contentArrayRe.exec(source))) {
    const windowEnd = Math.min(source.length, m.index + 300);
    const window = source.slice(m.index, windowEnd);
    if (/type\s*:\s*['"]text['"]/.test(window)) {
      const line = source.slice(0, m.index).split('\n').length;
      sites.push(line);
    }
  }
  return sites;
}

test('Invariant 12: a tool result object is constructed in exactly one place in src/, never ad hoc per tool', () => {
  const files = listJsFiles(SRC_ROOT);
  const sitesByFile = {};

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const sites = findResultShapeSites(source);
    if (sites.length > 0) {
      sitesByFile[path.relative(SRC_ROOT, file)] = sites;
    }
  }

  const filesWithSites = Object.keys(sitesByFile);
  const totalSites = filesWithSites.reduce((n, f) => n + sitesByFile[f].length, 0);

  const report = filesWithSites
    .map((f) => `  ${f}: line(s) ${sitesByFile[f].join(', ')}`)
    .join('\n');

  assert.equal(
    filesWithSites.length,
    1,
    `Expected tool-result-shaped object literals (content: [{ type: 'text', ... }]) ` +
      `to appear in exactly one file under src/ (a single shared result builder). ` +
      `Found them in ${filesWithSites.length} file(s), ${totalSites} site(s) total:\n${report}`
  );
});
