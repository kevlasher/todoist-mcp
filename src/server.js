/**
 * Server construction. Kept separate from the stdio bootstrap (index.js) so
 * tests can build a server and inspect exactly which tools got registered,
 * without opening a transport.
 *
 * The env-gated read-only decision happens HERE, once, at construction. The
 * write module is imported in every mode; only its registration is
 * conditional. When cfg.readOnly is truthy, registerWriteTools is never
 * called, so no write tool is registered and a client can neither list nor
 * call one. The condition is `!cfg.readOnly`, so a config that omits
 * readOnly registers them; src/index.js always passes loadConfig's boolean
 * (docs/SPEC.md, D-19). This is the server-layer read/write separation
 * (Invariant 8).
 */
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient } from './client.js';
import { registerReadTools } from './tools/read.js';
import { registerWriteTools } from './tools/write.js';
import { registerSecret } from './redact.js';
import { logger } from './logger.js';

// The name and version the server announces to MCP clients come from
// package.json, so they cannot drift from the published package.
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export function createServer(cfg) {
  // Register the token for redaction before anything can log or throw with it.
  registerSecret(cfg.apiKey);

  const server = new McpServer({
    name: PKG.name,
    version: PKG.version,
  });

  const client = createClient(cfg);

  const readNames = registerReadTools(server, client, cfg);
  let writeNames = [];
  if (!cfg.readOnly) {
    writeNames = registerWriteTools(server, client, cfg);
  }

  const toolNames = [...readNames, ...writeNames];
  logger.info(
    `Todoist MCP server constructed (${cfg.readOnly ? 'READ-ONLY' : 'READ/WRITE'}).`,
    { readTools: readNames.length, writeTools: writeNames.length }
  );

  return { server, toolNames, readNames, writeNames };
}
