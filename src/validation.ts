/**
 * Runtime input validation for MCP tool args.
 * Uses zod to validate untrusted JSON-RPC arguments before they reach tool logic.
 */

import { z } from "zod";

const Layer = z.enum(["episodic", "semantic", "procedural", "resource"]);
const EntityType = z.enum(["user", "project", "person", "concept", "file", "rule", "tool"]);
const SearchMode = z.enum(["fts", "exact"]);
const ExportFormat = z.enum(["json", "markdown", "claude-md"]);

const isoDatePrefix = z.string().regex(
  /^\d{4}-\d{2}-\d{2}/,
  "Must be an ISO 8601 date (YYYY-MM-DD...)"
);

export const MemoryAddSchema = z.object({
  content: z.string().min(1).max(100_000),
  layer: Layer,
  title: z.string().max(500).optional(),
  entity_type: EntityType.optional(),
  entity_name: z.string().max(500).optional(),
  event_at: isoDatePrefix.optional(),
  ttl_days: z.number().positive().optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  scope: z.string().max(200).optional(),
  source: z.string().max(200).optional(),
  source_file: z.string().max(1000).optional(),
  session_id: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const MemorySearchSchema = z.object({
  query: z.string().min(1).max(10_000),
  layers: z.array(Layer).optional(),
  entity_name: z.string().max(500).optional(),
  scope: z.string().max(200).optional(),
  date_from: isoDatePrefix.optional(),
  date_to: isoDatePrefix.optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  min_importance: z.number().min(0).max(1).optional(),
  include_superseded: z.boolean().optional(),
  limit: z.number().min(1).max(100).optional(),
  offset: z.number().min(0).optional(),
  mode: SearchMode.optional(),
});

export const MemoryUpdateSchema = z.object({
  id: z.string().min(1),
  content: z.string().max(100_000).optional(),
  title: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  supersede: z.boolean().optional(),
  new_content: z.string().max(100_000).optional(),
});

export const MemoryInspectSchema = z.object({
  id: z.string().optional(),
  layer: Layer.optional(),
  entity_name: z.string().max(500).optional(),
  include_history: z.boolean().optional(),
});

export const MemoryExportSchema = z.object({
  format: ExportFormat,
  layers: z.array(Layer).optional(),
  scope: z.string().max(200).optional(),
  include_superseded: z.boolean().optional(),
  date_from: isoDatePrefix.optional(),
  date_to: isoDatePrefix.optional(),
  limit: z.number().min(1).max(10_000).optional(),
});

export const MemoryDeleteSchema = z.object({
  id: z.string().min(1),
});
