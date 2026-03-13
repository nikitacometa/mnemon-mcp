/**
 * mnemon-mcp: HTTP transport entry point.
 *
 * Exposes the same tools as index.ts via StreamableHTTP transport.
 * Use for remote / multi-server deployments instead of stdio.
 *
 * Environment variables:
 *   MNEMON_PORT       - Listening port (default: 3000)
 *   MNEMON_AUTH_TOKEN - Bearer token for all requests (optional but recommended)
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { openDatabase } from "./db.js";
import { createMcpServer, loadExtraStopWords, version } from "./server.js";

// ---------------------------------------------------------------------------
// Database + config
// ---------------------------------------------------------------------------

const db = openDatabase();
loadExtraStopWords();

// ---------------------------------------------------------------------------
// Auth — timing-safe comparison to prevent token extraction via timing attack
// ---------------------------------------------------------------------------

const AUTH_TOKEN = process.env["MNEMON_AUTH_TOKEN"];
const MAX_BODY_BYTES = 1_048_576; // 1 MB

function isAuthorized(req: IncomingMessage): boolean {
  if (!AUTH_TOKEN) return true;
  const header = req.headers["authorization"] ?? "";
  const expected = `Bearer ${AUTH_TOKEN}`;
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

function rejectUnauthorized(res: ServerResponse): void {
  res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="mnemon-mcp"' });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

// ---------------------------------------------------------------------------
// HTTP server — stateless mode: new transport + server per request
// ---------------------------------------------------------------------------

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isAuthorized(req)) {
    rejectUnauthorized(res);
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost`);

  // Health check endpoint
  if (url.pathname === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version }));
    return;
  }

  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Use POST /mcp or GET /health" }));
    return;
  }

  // Body size limit
  const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    res.writeHead(413, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Request body too large (max ${MAX_BODY_BYTES} bytes)` }));
    return;
  }

  const transport = new StreamableHTTPServerTransport({});
  const server = createMcpServer(db);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await server.connect(transport as any);

  try {
    await transport.handleRequest(req, res);
  } finally {
    await server.close();
  }
}

// ---------------------------------------------------------------------------
// Start + graceful shutdown
// ---------------------------------------------------------------------------

const portRaw = parseInt(process.env["MNEMON_PORT"] ?? "3000", 10);
if (Number.isNaN(portRaw) || portRaw < 1 || portRaw > 65535) {
  console.error(`[mnemon-mcp http] Invalid MNEMON_PORT: "${process.env["MNEMON_PORT"]}". Must be 1-65535.`);
  process.exit(1);
}
const PORT = portRaw;

const httpServer = createServer((req, res) => {
  handleHttpRequest(req, res).catch((err) => {
    console.error(`[mnemon-mcp http] Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
});

function shutdown(): void {
  console.error("[mnemon-mcp http] Shutting down...");
  httpServer.close(() => {
    try {
      db.close();
    } catch {
      // Best-effort
    }
    process.exit(0);
  });
  // Force exit after 5s if graceful shutdown stalls
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

httpServer.listen(PORT, () => {
  console.error(`[mnemon-mcp http] v${version} listening on port ${PORT}${AUTH_TOKEN ? " (auth enabled)" : " (no auth — set MNEMON_AUTH_TOKEN for production)"}`);
  console.error(`[mnemon-mcp http] MCP endpoint: POST http://localhost:${PORT}/mcp`);
  console.error(`[mnemon-mcp http] Health check: GET http://localhost:${PORT}/health`);
});
