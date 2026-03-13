/**
 * mnemon-mcp: HTTP transport entry point.
 *
 * Exposes the same 5 tools as index.ts via StreamableHTTP transport.
 * Use for remote / multi-server deployments instead of stdio.
 *
 * Environment variables:
 *   MNEMON_PORT       - Listening port (default: 3000)
 *   MNEMON_AUTH_TOKEN - Bearer token required for all requests (optional)
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { openDatabase } from "./db.js";
import { memoryAdd, memoryAddSchema } from "./tools/memory-add.js";
import { memoryInspect, memoryInspectSchema } from "./tools/memory-inspect.js";
import { memorySearch, memorySearchSchema } from "./tools/memory-search.js";
import { memoryUpdate, memoryUpdateSchema } from "./tools/memory-update.js";
import { memoryExport, memoryExportSchema } from "./tools/memory-export.js";

import {
  MemoryAddSchema,
  MemorySearchSchema,
  MemoryUpdateSchema,
  MemoryInspectSchema,
  MemoryExportSchema,
} from "./validation.js";

import { loadConfig } from "./import/config-loader.js";
import { addExtraStopWords } from "./stop-words.js";

import type {
  MemoryAddInput,
  MemoryExportInput,
  MemoryInspectInput,
  MemorySearchInput,
  MemoryUpdateInput,
} from "./types.js";

// ---------------------------------------------------------------------------
// Database + config
// ---------------------------------------------------------------------------

const db = openDatabase();

try {
  const config = loadConfig();
  if (config.extraStopWords.length > 0) {
    addExtraStopWords(config.extraStopWords);
  }
} catch {
  // Best-effort — import pipeline handles config errors
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const AUTH_TOKEN = process.env["MNEMON_AUTH_TOKEN"];

function isAuthorized(req: IncomingMessage): boolean {
  if (!AUTH_TOKEN) return true;
  const header = req.headers["authorization"] ?? "";
  return header === `Bearer ${AUTH_TOKEN}`;
}

function rejectUnauthorized(res: ServerResponse): void {
  res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="mnemon-mcp"' });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

// ---------------------------------------------------------------------------
// MCP Server factory — stateless: one Server + Transport per request
// ---------------------------------------------------------------------------

function createMcpServer(): Server {
  const server = new Server(
    { name: "mnemon-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "memory_add",
        description:
          "Add a new memory to the persistent store. Supports 4 cognitive layers: episodic (events/sessions), semantic (facts/concepts), procedural (rules/workflows), resource (reference material). Automatically supersedes previous entries from the same source_file.",
        inputSchema: memoryAddSchema,
      },
      {
        name: "memory_search",
        description:
          "Full-text search across all memory layers using FTS5. Supports layer/entity/date/scope filtering. Returns scored results with snippets. Superseded entries excluded by default.",
        inputSchema: memorySearchSchema,
      },
      {
        name: "memory_update",
        description:
          "Update an existing memory. Use supersede=true to create a versioned replacement (preserves history chain). Use supersede=false (default) to update fields in place.",
        inputSchema: memoryUpdateSchema,
      },
      {
        name: "memory_inspect",
        description:
          "Inspect memory details or layer statistics. Without id: returns aggregate stats per layer (total, active, superseded, avg_confidence, top_entities). With id: returns the full memory row and optionally its history chain.",
        inputSchema: memoryInspectSchema,
      },
      {
        name: "memory_export",
        description:
          "Export memories to JSON, Markdown, or claude-md (compact LLM-optimized) format. Supports filtering by layer, scope, date range. Returns the exported content as a string.",
        inputSchema: memoryExportSchema,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "memory_add": {
          const input = MemoryAddSchema.parse(args) as MemoryAddInput;
          const result = memoryAdd(db, input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        case "memory_search": {
          const input = MemorySearchSchema.parse(args) as MemorySearchInput;
          const result = memorySearch(db, input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        case "memory_update": {
          const input = MemoryUpdateSchema.parse(args) as MemoryUpdateInput;
          const result = memoryUpdate(db, input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        case "memory_inspect": {
          const input = MemoryInspectSchema.parse(args) as MemoryInspectInput;
          const result = memoryInspect(db, input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        case "memory_export": {
          const input = MemoryExportSchema.parse(args) as MemoryExportInput;
          const result = memoryExport(db, input);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// HTTP server — stateless mode: new transport per request
// ---------------------------------------------------------------------------

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isAuthorized(req)) {
    rejectUnauthorized(res);
    return;
  }

  // Only /mcp endpoint is handled; everything else gets 404
  const url = new URL(req.url ?? "/", `http://localhost`);
  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Use POST /mcp" }));
    return;
  }

  // Stateless mode: omit sessionIdGenerator entirely (exactOptionalPropertyTypes-safe)
  const transport = new StreamableHTTPServerTransport({});
  const server = createMcpServer();
  // Type assertion needed: StreamableHTTPServerTransport getter/setter types are
  // wider than Transport interface under exactOptionalPropertyTypes=true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await server.connect(transport as any);

  try {
    await transport.handleRequest(req, res);
  } finally {
    await server.close();
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env["MNEMON_PORT"] ?? "3000", 10);

const httpServer = createServer((req, res) => {
  handleHttpRequest(req, res).catch((err) => {
    console.error(`[mnemon-mcp http] Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
});

httpServer.listen(PORT, () => {
  console.error(`[mnemon-mcp http] Listening on port ${PORT}${AUTH_TOKEN ? " (auth enabled)" : " (no auth)"}`);
  console.error(`[mnemon-mcp http] MCP endpoint: POST http://localhost:${PORT}/mcp`);
});
