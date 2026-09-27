#!/usr/bin/env node
/**
 * Boots the REAL server process (src/index.js) over stdio via the MCP client's
 * StdioClientTransport and lists tools. Used to confirm, against an actually
 * spawned process (not the in-process harness), that read-only mode registers
 * no write tools. Uses a fake token; no network call is made by tools/list.
 *
 * Usage: TODOIST_READONLY=true node scripts/stdio-check.js
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = join(__dirname, '..', 'src', 'index.js');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  env: {
    ...process.env,
    TODOIST_API_KEY: process.env.TODOIST_API_KEY ?? 'fake-token-for-listing-only',
  },
});

const client = new Client({ name: 'stdio-check', version: '1.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
console.log(JSON.stringify({ mode: process.env.TODOIST_READONLY ?? '(unset)', tools: names }, null, 2));
await client.close();
process.exit(0);
