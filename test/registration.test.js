import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

const READ_TOOLS = [
  'find-tasks',
  'find-tasks-by-date',
  'find-projects',
  'find-sections',
  'find-labels',
  'find-comments',
  'get-overview',
];

const WRITE_TOOLS = [
  'add-tasks',
  'update-tasks',
  'complete-tasks',
  'uncomplete-tasks',
  'reschedule-tasks',
  'add-comments',
  'add-projects',
  'add-sections',
  'add-labels',
];

// Tools that must NEVER be registered in any mode.
const FORBIDDEN = [
  'delete-object',
  'manage-assignments',
  'list-workspaces',
  'find-project-collaborators',
  'get-workspace-insights',
  'analyze-project-health',
  'get-productivity-stats',
  'get-project-activity-stats',
  'project-health',
  'reorder-objects',
  'project-move',
  'add-reminders',
  'add-filters',
  'update-filters',
];

function baseCfg(overrides = {}) {
  return {
    apiKey: 'fake-token-abcdef',
    readOnly: true,
    maxOutputChars: 50000,
    maxFieldChars: 2000,
    maxItems: 200,
    ...overrides,
  };
}

test('read-only mode registers only the 7 read tools, no writes', () => {
  const { toolNames, readNames, writeNames } = createServer(baseCfg({ readOnly: true }));
  assert.deepEqual(readNames.sort(), [...READ_TOOLS].sort());
  assert.deepEqual(writeNames, []);
  for (const w of WRITE_TOOLS) {
    assert.ok(!toolNames.includes(w), `write tool ${w} must be absent in read-only mode`);
  }
});

test('read/write mode registers the full 16-tool set', () => {
  const { toolNames } = createServer(baseCfg({ readOnly: false }));
  for (const t of [...READ_TOOLS, ...WRITE_TOOLS]) {
    assert.ok(toolNames.includes(t), `tool ${t} should be registered`);
  }
  assert.equal(toolNames.length, 16);
});

test('forbidden tools are never registered in either mode', () => {
  for (const readOnly of [true, false]) {
    const { toolNames } = createServer(baseCfg({ readOnly }));
    for (const f of FORBIDDEN) {
      assert.ok(
        !toolNames.includes(f),
        `forbidden tool ${f} must not be registered (readOnly=${readOnly})`
      );
    }
  }
});
