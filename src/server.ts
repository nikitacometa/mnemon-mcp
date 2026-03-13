/**
 * Shared MCP server factory — used by both stdio and HTTP entry points.
 *
 * Centralizes tool registration, dispatch, and config loading so that
 * index.ts and index-http.ts only handle transport-specific concerns.
 */

import type Database from "better-sqlite3";
import { createRequire } from "node:module";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { memoryAdd, memoryAddSchema } from "./tools/memory-add.js";
import { memorySearch, memorySearchSchema } from "./tools/memory-search.js";
import { memoryUpdate, memoryUpdateSchema } from "./tools/memory-update.js";
import { memoryInspect, memoryInspectSchema } from "./tools/memory-inspect.js";
import { memoryExport, memoryExportSchema } from "./tools/memory-export.js";
import { memoryDelete, memoryDeleteSchema } from "./tools/memory-delete.js";

import {
  MemoryAddSchema,
  MemorySearchSchema,
  MemoryUpdateSchema,
  MemoryInspectSchema,
  MemoryExportSchema,
  MemoryDeleteSchema,
} from "./validation.js";

import type {
  MemoryAddInput,
  MemorySearchInput,
  MemoryUpdateInput,
  MemoryInspectInput,
  MemoryExportInput,
  MemoryDeleteInput,
} from "./types.js";

import { loadConfig } from "./import/config-loader.js";
import { addExtraStopWords } from "./stop-words.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export { version };

/** Load extra stop words from config (best-effort, non-fatal). */
export function loadExtraStopWords(): void {
  try {
    const config = loadConfig();
    if (config.extraStopWords.length > 0) {
      addExtraStopWords(config.extraStopWords);
    }
  } catch {
    // Config loading is best-effort for the MCP server
  }
}

/** Create an MCP server with all memory tools registered. */
export function createMcpServer(db: Database.Database): Server {
  const server = new Server(
    { name: "mnemon-mcp", version },
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
        name: "memory_delete",
        description:
          "Permanently delete a memory by ID. Cleans up superseding chain references: re-activates predecessor if one exists.",
        inputSchema: memoryDeleteSchema,
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
        case "memory_delete": {
          const input = MemoryDeleteSchema.parse(args) as MemoryDeleteInput;
          const result = memoryDelete(db, input);
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
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}
