/**
 * style_extract — stub implementation.
 * Writing style analysis pipeline is not yet implemented.
 */

import type Database from "better-sqlite3";
import type { StyleExtractInput, StyleExtractOutput } from "../types.js";

export function styleExtract(
  _db: Database.Database,
  _input: StyleExtractInput
): StyleExtractOutput {
  throw new Error(
    "style_extract is not implemented yet. " +
      "Planned: analyze writing patterns and vocabulary from source files, " +
      "store as procedural memory. " +
      "Track progress at https://github.com/nikitacometa/persona-mcp"
  );
}

/** JSON Schema for MCP tool registration */
export const styleExtractSchema = {
  type: "object",
  properties: {
    source: {
      type: "string",
      enum: ["file", "directory", "inline"],
      description: "Source type: file path, directory glob, or inline text",
    },
    path: {
      type: "string",
      description: "File or directory path (required for source=file|directory)",
    },
    content: {
      type: "string",
      description: "Inline text to analyze (required for source=inline)",
    },
    file_glob: {
      type: "string",
      description: "Glob pattern to filter files in directory (e.g. '**/*.md')",
    },
    store_as_procedural: {
      type: "boolean",
      description: "Store extracted style profile as a procedural memory",
    },
    scope: {
      type: "string",
      description: "Scope for the stored memory",
    },
  },
  required: ["source"],
} as const;
