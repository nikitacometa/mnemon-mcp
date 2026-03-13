/**
 * memory_export — export memories to JSON or Markdown format.
 *
 * Supports filtering by layer, scope, date range.
 * Returns the exported content as a string (JSON or Markdown).
 */

import type Database from "better-sqlite3";
import type { MemoryExportInput, MemoryExportOutput, MemoryRow } from "../types.js";

type ExportRow = Pick<
  MemoryRow,
  | "id" | "layer" | "title" | "content" | "entity_type" | "entity_name"
  | "confidence" | "importance" | "scope" | "created_at" | "event_at"
  | "source" | "source_file" | "superseded_by"
>;

const DEFAULT_EXPORT_LIMIT = 1000;
const MAX_EXPORT_LIMIT = 10000;

export function memoryExport(
  db: Database.Database,
  input: MemoryExportInput
): MemoryExportOutput {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (!input.include_superseded) {
    conditions.push("superseded_by IS NULL");
  }

  if (input.layers && input.layers.length > 0) {
    const placeholders = input.layers.map(() => "?").join(", ");
    conditions.push(`layer IN (${placeholders})`);
    params.push(...input.layers);
  }

  if (input.scope) {
    conditions.push("scope = ?");
    params.push(input.scope);
  }

  if (input.date_from) {
    conditions.push("COALESCE(event_at, created_at) >= ?");
    params.push(input.date_from);
  }

  if (input.date_to) {
    conditions.push("COALESCE(event_at, created_at) <= ?");
    params.push(input.date_to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(input.limit ?? DEFAULT_EXPORT_LIMIT, MAX_EXPORT_LIMIT);
  params.push(limit);

  const rows = db
    .prepare<unknown[], ExportRow>(
      `SELECT id, layer, title, content, entity_type, entity_name,
              confidence, importance, scope, created_at, event_at,
              source, source_file, superseded_by
       FROM memories
       ${where}
       ORDER BY layer, created_at DESC
       LIMIT ?`
    )
    .all(...params);

  let content: string;

  switch (input.format) {
    case "json":
      content = JSON.stringify(rows, null, 2);
      break;
    case "markdown":
      content = formatMarkdown(rows);
      break;
    case "claude-md":
      content = formatClaudeMd(rows);
      break;
    default: {
      const _exhaustive: never = input.format;
      throw new Error(`Unsupported export format: ${_exhaustive}`);
    }
  }

  return {
    format: input.format,
    count: rows.length,
    content,
  };
}

function formatMarkdown(rows: ExportRow[]): string {
  const lines: string[] = [`# Memory Export`, ``, `Total: ${rows.length} memories`, ``];

  // Group by layer
  const byLayer = new Map<string, ExportRow[]>();
  for (const row of rows) {
    const existing = byLayer.get(row.layer) ?? [];
    existing.push(row);
    byLayer.set(row.layer, existing);
  }

  for (const [layer, memories] of byLayer) {
    lines.push(`## ${layer} (${memories.length})`, ``);

    for (const m of memories) {
      const title = m.title ?? "(untitled)";
      const entity = m.entity_name ? ` [${m.entity_name}]` : "";
      lines.push(`### ${title}${entity}`, ``);

      if (m.event_at) lines.push(`- **Date:** ${m.event_at}`);
      lines.push(`- **Confidence:** ${m.confidence} | **Importance:** ${m.importance}`);
      if (m.entity_type) lines.push(`- **Entity:** ${m.entity_type}`);
      lines.push(``);
      lines.push(m.content, ``);
    }
  }

  return lines.join("\n");
}

function formatClaudeMd(rows: ExportRow[]): string {
  // Compact format optimized for LLM context injection
  const lines: string[] = [];

  for (const m of rows) {
    const title = m.title ?? "(untitled)";
    const meta = [m.layer, m.entity_name, m.event_at].filter(Boolean).join(" | ");
    lines.push(`## ${title}`, `<!-- ${meta} -->`, ``, m.content, ``);
  }

  return lines.join("\n");
}

/** JSON Schema for MCP tool registration */
export const memoryExportSchema = {
  type: "object",
  properties: {
    format: {
      type: "string",
      enum: ["json", "markdown", "claude-md"],
      description:
        "Export format: json (structured), markdown (human-readable), claude-md (compact for LLM context)",
    },
    layers: {
      type: "array",
      items: { type: "string", enum: ["episodic", "semantic", "procedural", "resource"] },
      description: "Filter by memory layers (omit for all)",
    },
    scope: {
      type: "string",
      description: "Filter by scope (e.g. 'global', 'project-name')",
    },
    include_superseded: {
      type: "boolean",
      description: "Include superseded (old version) memories (default: false)",
    },
    date_from: {
      type: "string",
      description: "Filter: event date (event_at if set, else created_at) >= ISO 8601 date",
    },
    date_to: {
      type: "string",
      description: "Filter: event date (event_at if set, else created_at) <= ISO 8601 date",
    },
    limit: {
      type: "number",
      description: "Maximum entries to export (default 1000, max 10000)",
    },
  },
  required: ["format"],
};
