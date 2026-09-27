#!/usr/bin/env node
/**
 * Local stdio entry point for the purpose-built Todoist MCP server.
 *
 * stdout is owned by the MCP stdio transport; all diagnostics go to stderr
 * (see logger.js). Config, including the read-only decision, is read once,
 * here, at startup.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { logger } from './logger.js';
import { redact } from './redact.js';

async function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    // Config errors are fatal and must never echo the token.
    process.stderr.write(`[fatal] ${redact(err.message)}\n`);
    process.exit(1);
  }

  const { server, toolNames } = createServer(cfg);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Todoist MCP server listening on stdio.', { tools: toolNames });
}

main().catch((err) => {
  process.stderr.write(`[fatal] ${redact(err?.stack ?? String(err))}\n`);
  process.exit(1);
});
