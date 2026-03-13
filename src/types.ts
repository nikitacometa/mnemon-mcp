/**
 * Shared TypeScript types for mnemon-mcp.
 * All types correspond 1:1 to SQLite schema columns.
 */

export type Layer = "episodic" | "semantic" | "procedural" | "resource";

export type EntityType =
  | "user"
  | "project"
  | "person"
  | "concept"
  | "file"
  | "rule"
  | "tool";

export type MemorySource =
  | "claude-code"
  | "cursor"
  | "api"
  | `import:${"claude-md" | "kb" | "chatgpt-export" | string}`;

export type SearchMode = "fts" | "exact";


// ---------------------------------------------------------------------------
// Row types (mirror SQLite columns)
// ---------------------------------------------------------------------------

export interface MemoryRow {
  id: string;
  layer: Layer;
  content: string;
  title: string | null;
  source: string;
  source_file: string | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
  event_at: string | null;
  expires_at: string | null;
  confidence: number;
  importance: number;
  access_count: number;
  last_accessed: string | null;
  superseded_by: string | null;
  supersedes: string | null;
  entity_type: EntityType | null;
  entity_name: string | null;
  scope: string;
  embedding: Buffer | null;
  meta: string; // JSON string
  valid_from: string | null;
  valid_until: string | null;
}

export interface SessionRow {
  id: string;
  client: string;
  project: string | null;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  meta: string; // JSON string
}

export interface ImportLogRow {
  id: string;
  source_path: string;
  source_type: "claude-md" | "kb-markdown" | "json" | "chatgpt-export";
  imported_at: string;
  memories_created: number;
  memories_updated: number;
  file_hash: string | null;
  status: "success" | "partial" | "failed";
  errors: string; // JSON string
}

export type EventType = "created" | "updated" | "superseded" | "deleted";

export interface EventLogRow {
  id: string;
  memory_id: string;
  event_type: EventType;
  actor: string;
  old_content: string | null;
  new_content: string | null;
  diff_meta: string;
  occurred_at: string;
}

// ---------------------------------------------------------------------------
// Tool input types
// ---------------------------------------------------------------------------

export interface MemoryAddInput {
  content: string;
  layer: Layer;
  title?: string;
  entity_type?: EntityType;
  entity_name?: string;
  event_at?: string;
  ttl_days?: number;
  confidence?: number;
  importance?: number;
  scope?: string;
  source?: string;
  source_file?: string;
  session_id?: string;
  meta?: Record<string, unknown>;
  valid_from?: string;
  valid_until?: string;
}

export interface MemorySearchInput {
  query: string;
  layers?: Layer[];
  entity_name?: string;
  scope?: string;
  date_from?: string;
  date_to?: string;
  min_confidence?: number;
  min_importance?: number;
  include_superseded?: boolean;
  limit?: number;
  offset?: number;
  mode?: SearchMode;
  as_of?: string;
}

export interface MemoryUpdateInput {
  id: string;
  content?: string;
  title?: string;
  confidence?: number;
  importance?: number;
  meta?: Record<string, unknown>;
  supersede?: boolean;
  new_content?: string;
}

export interface MemoryInspectInput {
  id?: string;
  layer?: Layer;
  entity_name?: string;
  include_history?: boolean;
}

export interface MemoryExportInput {
  format: "json" | "markdown" | "claude-md";
  layers?: Layer[];
  scope?: string;
  include_superseded?: boolean;
  date_from?: string;
  date_to?: string;
  limit?: number;
}

export interface MemoryDeleteInput {
  id: string;
}

export interface MemoryDeleteOutput {
  deleted_id: string;
}

export interface MemoryExportOutput {
  format: string;
  count: number;
  content: string;
}


// ---------------------------------------------------------------------------
// Tool output types
// ---------------------------------------------------------------------------

export interface MemoryAddOutput {
  id: string;
  layer: Layer;
  created: boolean;
  superseded_ids?: string[];
  potential_conflicts?: Array<{ id: string; snippet: string }>;
}

export interface MemorySearchResult {
  id: string;
  layer: Layer;
  title: string | null;
  content: string;
  snippet: string;
  score: number;
  entity_type: EntityType | null;
  entity_name: string | null;
  confidence: number;
  importance: number;
  scope: string;
  created_at: string;
  event_at: string | null;
}

export interface MemorySearchOutput {
  memories: MemorySearchResult[];
  /**
   * Number of results returned after post-filter (superseded, confidence, importance).
   * This is NOT the total count of matching rows in the DB — it equals memories.length.
   */
  total_found: number;
  query_time_ms: number;
}

export interface MemoryUpdateOutput {
  updated_id: string;
  new_id?: string;
  superseded: boolean;
}

export interface LayerStat {
  total: number;
  active: number;
  superseded: number;
  avg_confidence: number;
  never_accessed: number;
  stale_count: number;
  avg_age_days: number;
  top_entities: Array<{ entity_name: string; count: number }>;
}

export interface MemoryInspectOutput {
  memory?: MemoryRow;
  layer_stats?: Record<Layer, LayerStat>;
  superseded_chain?: MemoryRow[];
}

