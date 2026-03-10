/**
 * Runtime input validation for MCP tool args.
 * Uses zod to validate untrusted JSON-RPC arguments before they reach tool logic.
 */

import { z } from "zod";

const Layer = z.enum(["episodic", "semantic", "procedural", "resource"]);
const EntityType = z.enum(["user", "project", "person", "concept", "file", "rule", "tool"]);
const SearchMode = z.enum(["fts", "exact", "hybrid"]);
const ExportFormat = z.enum(["json", "markdown", "claude-md"]);

export const MemoryAddSchema = z.object({
  content: z.string().min(1),
  layer: Layer,
  title: z.string().optional(),
  entity_type: EntityType.optional(),
  entity_name: z.string().optional(),
  event_at: z.string().optional(),
  ttl_days: z.number().positive().optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  scope: z.string().optional(),
  source: z.string().optional(),
  source_file: z.string().optional(),
  session_id: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const MemorySearchSchema = z.object({
  query: z.string().min(1),
  layers: z.array(Layer).optional(),
  entity_name: z.string().optional(),
  scope: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  min_importance: z.number().min(0).max(1).optional(),
  include_superseded: z.boolean().optional(),
  limit: z.number().min(1).max(100).optional(),
  mode: SearchMode.optional(),
});

export const MemoryUpdateSchema = z.object({
  id: z.string().min(1),
  content: z.string().optional(),
  title: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  supersede: z.boolean().optional(),
  new_content: z.string().optional(),
});

export const MemoryInspectSchema = z.object({
  id: z.string().optional(),
  layer: Layer.optional(),
  entity_name: z.string().optional(),
  include_history: z.boolean().optional(),
});

export const MemoryExportSchema = z.object({
  format: ExportFormat,
  layers: z.array(Layer).optional(),
  scope: z.string().optional(),
  include_superseded: z.boolean().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  output_path: z.string().optional(),
});

export const StyleExtractSchema = z.object({
  source: z.enum(["file", "directory", "inline"]),
  path: z.string().optional(),
  content: z.string().optional(),
  file_glob: z.string().optional(),
  store_as_procedural: z.boolean().optional(),
  scope: z.string().optional(),
});
