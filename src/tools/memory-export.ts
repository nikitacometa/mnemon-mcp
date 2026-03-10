/**
 * memory_export — stub implementation.
 * Full export pipeline is not yet implemented.
 */

import type Database from "better-sqlite3";
import type { MemoryExportInput, MemoryExportOutput } from "../types.js";

export function memoryExport(
  _db: Database.Database,
  _input: MemoryExportInput
): MemoryExportOutput {
  throw new Error(
    "memory_export is not implemented yet. " +
      "Planned formats: json, markdown, claude-md. " +
      "Track progress at https://github.com/nikitacometa/mnemon-mcp"
  );
}

/** JSON Schema for MCP tool registration */
export const memoryExportSchema = {
  type: "object",
  properties: {
    format: {
      type: "string",
      enum: ["json", "markdown", "claude-md"],
      description: "Output format",
    },
    layers: {
      type: "array",
      items: {
        type: "string",
        enum: ["episodic", "semantic", "procedural", "resource"],
      },
      description: "Layers to export (default: all)",
    },
    scope: {
      type: "string",
      description: "Filter by scope",
    },
    include_superseded: {
      type: "boolean",
      description: "Include superseded entries (default false)",
    },
    date_from: {
      type: "string",
      description: "ISO 8601 start date filter",
    },
    date_to: {
      type: "string",
      description: "ISO 8601 end date filter",
    },
    output_path: {
      type: "string",
      description: "Write output to file path (optional — returns inline if omitted)",
    },
  },
  required: ["format"],
} as const;
