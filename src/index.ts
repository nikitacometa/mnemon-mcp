/**
 * mnemon-mcp: MCP server entry point.
 *
 * Exposes 6 tools: memory_add, memory_search, memory_update,
 * memory_inspect, memory_export (stub), style_extract (stub).
 *
 * Transport: stdio — suitable for Claude Code MCP config.
 * Database: ~/.mnemon-mcp/memory.db (SQLite + FTS5, WAL mode).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { openDatabase } from "./db.js";
import { memoryAdd, memoryAddSchema } from "./tools/memory-add.js";
import { memoryExport, memoryExportSchema } from "./tools/memory-export.js";
import { memoryInspect, memoryInspectSchema } from "./tools/memory-inspect.js";
import { memorySearch, memorySearchSchema } from "./tools/memory-search.js";
import { memoryUpdate, memoryUpdateSchema } from "./tools/memory-update.js";
import { styleExtract, styleExtractSchema } from "./tools/style-extract.js";

import type {
  MemoryAddInput,
  MemoryExportInput,
  MemoryInspectInput,
  MemorySearchInput,
  MemoryUpdateInput,
  StyleExtractInput,
} from "./types.js";

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const db = openDatabase();

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: "mnemon-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, () => {
  return {
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
          "[STUB] Export memories to json/markdown/claude-md format. Not yet implemented.",
        inputSchema: memoryExportSchema,
      },
      {
        name: "style_extract",
        description:
          "[STUB] Analyze writing style from files or inline text and store as procedural memory. Not yet implemented.",
        inputSchema: styleExtractSchema,
      },
    ],
  };
});

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "memory_add": {
        const result = memoryAdd(db, args as unknown as MemoryAddInput);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "memory_search": {
        const result = memorySearch(db, args as unknown as MemorySearchInput);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "memory_update": {
        const result = memoryUpdate(db, args as unknown as MemoryUpdateInput);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "memory_inspect": {
        const result = memoryInspect(db, args as unknown as MemoryInspectInput);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "memory_export": {
        const result = memoryExport(db, args as unknown as MemoryExportInput);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "style_extract": {
        const result = styleExtract(db, args as unknown as StyleExtractInput);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers communicate only via stdio — no console.log allowed here
  // (it would corrupt the JSON-RPC stream)
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
