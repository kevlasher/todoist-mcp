/**
 * All logging goes to stderr (stdout is reserved for the MCP stdio transport)
 * and every line passes through the redactor so the token can never leak.
 */
import { redact } from './redact.js';

function emit(level, msg, meta) {
  const parts = [`[${new Date().toISOString()}]`, `[${level}]`, redact(msg)];
  if (meta !== undefined) {
    try {
      parts.push(redact(JSON.stringify(meta)));
    } catch {
      parts.push('[unserializable meta]');
    }
  }
  process.stderr.write(parts.join(' ') + '\n');
}

export const logger = {
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
};
