/**
 * mnemon-mcp: MCP server entry point (stdio transport).
 *
 * Suitable for Claude Code MCP config.
 * Database: ~/.mnemon-mcp/memory.db (SQLite + FTS5, WAL mode).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDatabase } from "./db.js";
import { createMcpServer, loadExtraStopWords } from "./server.js";

let db: ReturnType<typeof openDatabase>;

try {
  db = openDatabase();
} catch (err) {
  process.stderr.write(`Failed to open database: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

loadExtraStopWords();

const server = createMcpServer(db);

// Graceful shutdown: close DB and checkpoint WAL
function shutdown(): void {
  try {
    db.close();
  } catch {
    // Best-effort on shutdown
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
