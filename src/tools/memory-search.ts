/**
 * memory_search — FTS5-backed search with layer/entity/date/scope filtering.
 *
 * Default mode: 'fts' — tokenize query into words, build FTS5 AND query.
 * Scores via FTS5 bm25(), normalized to 0–1 range.
 * Superseded entries excluded unless include_superseded=true.
 *
 * Search modes:
 *   fts    — FTS5 tokenized search (default)
 *   exact  — LIKE substring match, fixed score 1.0
 *   hybrid — currently aliases to 'fts'; reserved for future semantic re-ranking
 */

import type Database from "better-sqlite3";
import type {
  EntityType,
  Layer,
  MemorySearchInput,
  MemorySearchOutput,
  MemorySearchResult,
} from "../types.js";
import { isStopWord } from "../stop-words.js";
import { stemWord } from "../stemmer.js";

const DEFAULT_LIMIT = 10;
const SNIPPET_TOKENS = 64;

/** Escape FTS5 special characters to prevent syntax errors */
function escapeFtsToken(token: string): string {
  // Remove all FTS5 query syntax chars: quotes, prefix, column filter, grouping, negation
  return token.replace(/["^*():]/g, "").replace(/\b(AND|OR|NOT|NEAR)\b/gi, "");
}

/**
 * Build FTS5 MATCH query from user query string.
 * 1. Splits on whitespace
 * 2. Removes stop words (Russian + English) to avoid over-restrictive AND queries
 * 3. Escapes FTS5 special chars
 * 4. Applies prefix matching for tokens ≥ 4 chars (morphological variants)
 *
 * If ALL tokens are stop words, falls back to using original tokens
 * (graceful degradation — better to search with stop words than return nothing).
 */
function buildFtsQuery(query: string, operator: "AND" | "OR" = "AND"): string {
  const rawTokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  // Filter stop words, keeping original tokens as fallback
  const contentTokens = rawTokens.filter((t) => !isStopWord(t.toLowerCase()));
  const effectiveTokens = contentTokens.length > 0 ? contentTokens : rawTokens;

  const ftsTokens = effectiveTokens
    .map((t) => {
      const escaped = escapeFtsToken(t);
      if (!escaped) return "";
      // Stem the token for better morphological matching
      // e.g. "субличностях" → stem "субличн" → "субличн"* matches "субличность"
      const stemmed = stemWord(escaped);
      // Use the shorter of stemmed/original for prefix matching (wider recall)
      const prefix = stemmed.length < escaped.length ? stemmed : escaped;
      if (prefix.length >= 3) {
        return `"${prefix}"*`;
      }
      return `"${escaped}"`;
    })
    .filter((t) => t !== "" && t !== '""');

  if (ftsTokens.length === 0) {
    throw new Error("Query must contain at least one non-empty term");
  }

  return ftsTokens.join(` ${operator} `);
}

/** Normalize BM25 score (negative rank) to 0–1 */
function normalizeBm25(rank: number): number {
  return 1 / (1 + Math.abs(rank));
}

/** Generate a plain-text snippet from content (first SNIPPET_TOKENS words) */
function makeSnippet(content: string): string {
  const words = content.split(/\s+/);
  if (words.length <= SNIPPET_TOKENS) return content;
  return words.slice(0, SNIPPET_TOKENS).join(" ") + "…";
}

interface FtsRow {
  id: string;
  rank: number;
}

interface MemoryBaseRow {
  id: string;
  layer: string;
  title: string | null;
  content: string;
  entity_type: string | null;
  entity_name: string | null;
  confidence: number;
  importance: number;
  scope: string;
  created_at: string;
  event_at: string | null;
  superseded_by: string | null;
}

export function memorySearch(
  db: Database.Database,
  input: MemorySearchInput
): MemorySearchOutput {
  const startMs = Date.now();
  const limit = input.limit ?? DEFAULT_LIMIT;
  const mode = input.mode ?? "fts";

  let ids: Array<{ id: string; score: number }>;

  if (mode === "exact") {
    ids = exactSearch(db, input, limit);
  } else {
    // 'fts' and 'hybrid' both use FTS5; 'hybrid' is reserved for future semantic re-ranking
    ids = ftsSearch(db, input, limit);
  }

  if (ids.length === 0) {
    return { memories: [], total_found: 0, query_time_ms: Date.now() - startMs };
  }

  // Fetch full rows for matched IDs
  const idList = ids.map((r) => r.id);
  const placeholders = idList.map(() => "?").join(", ");

  const rows = db
    .prepare<string[], MemoryBaseRow>(
      `SELECT id, layer, title, content, entity_type, entity_name,
              confidence, importance, scope, created_at, event_at, superseded_by
       FROM memories
       WHERE id IN (${placeholders})`
    )
    .all(...idList);

  // Map back scores, boost by importance for ranking
  // Formula: final_score = bm25_score * (0.5 + 0.5 * importance)
  // This gives high-importance memories (0.9) a 15% advantage over low-importance (0.6)
  const scoreMap = new Map(ids.map((r) => [r.id, r.score]));

  const memories: MemorySearchResult[] = rows
    .filter((row) => {
      if (!input.include_superseded && row.superseded_by !== null) return false;
      if (input.min_confidence !== undefined && row.confidence < input.min_confidence) return false;
      if (input.min_importance !== undefined && row.importance < input.min_importance) return false;
      return true;
    })
    .map((row) => {
      const bm25Score = scoreMap.get(row.id) ?? 0;
      const importanceBoost = 0.5 + 0.5 * row.importance;
      return {
      id: row.id,
      layer: row.layer as Layer,
      title: row.title,
      content: row.content,
      snippet: makeSnippet(row.content),
      score: bm25Score * importanceBoost,
      entity_type: row.entity_type as EntityType | null,
      entity_name: row.entity_name,
      confidence: row.confidence,
      importance: row.importance,
      scope: row.scope,
      created_at: row.created_at,
      event_at: row.event_at,
    };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Update access tracking for returned results
  if (memories.length > 0) {
    const updateIds = memories.map((m) => m.id);
    const ph = updateIds.map(() => "?").join(", ");
    db.prepare(
      `UPDATE memories SET access_count = access_count + 1,
              last_accessed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id IN (${ph})`
    ).run(...updateIds);
  }

  return {
    memories,
    total_found: memories.length,
    query_time_ms: Date.now() - startMs,
  };
}

function ftsSearch(
  db: Database.Database,
  input: MemorySearchInput,
  limit: number
): Array<{ id: string; score: number }> {
  let ftsQuery: string;
  try {
    ftsQuery = buildFtsQuery(input.query, "AND");
  } catch {
    return [];
  }

  const conditions: string[] = ["fts.id = m.id"];

  if (!input.include_superseded) {
    conditions.push("m.superseded_by IS NULL");
  }

  // Exclude expired memories
  conditions.push("(m.expires_at IS NULL OR m.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))");

  if (input.layers && input.layers.length > 0) {
    const placeholders = input.layers.map(() => "?").join(", ");
    conditions.push(`m.layer IN (${placeholders})`);
  }

  if (input.entity_name) {
    conditions.push("m.entity_name = ?");
  }

  if (input.scope) {
    conditions.push("m.scope = ?");
  }

  if (input.date_from) {
    conditions.push("COALESCE(m.event_at, m.created_at) >= ?");
  }

  if (input.date_to) {
    conditions.push("COALESCE(m.event_at, m.created_at) <= ?");
  }

  const whereClause =
    conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

  // Field weights for bm25(): title=5x, content=1x, entity_name=3x
  // This boosts matches in title/entity_name over body content
  const sql = `
    SELECT fts.id, bm25(memories_fts, 5.0, 1.0, 3.0) AS rank
    FROM memories_fts fts
    JOIN memories m ON fts.id = m.id
    WHERE memories_fts MATCH ?
      ${whereClause}
    ORDER BY rank
    LIMIT ?
  `;

  const params: unknown[] = [ftsQuery];

  if (input.layers && input.layers.length > 0) {
    params.push(...input.layers);
  }
  if (input.entity_name) params.push(input.entity_name);
  if (input.scope) params.push(input.scope);
  if (input.date_from) params.push(input.date_from);
  if (input.date_to) params.push(input.date_to);
  params.push(limit * 2); // fetch extra to allow post-filter

  try {
    const rows = db.prepare<unknown[], FtsRow>(sql).all(...params);
    const results = rows.map((r) => ({ id: r.id, score: normalizeBm25(r.rank) }));

    // Fallback: if AND returns nothing and query has multiple tokens, retry with OR
    if (results.length === 0 && input.query.trim().split(/\s+/).length > 1) {
      const orQuery = buildFtsQuery(input.query, "OR");
      const orParams = [orQuery, ...params.slice(1)];
      const orRows = db.prepare<unknown[], FtsRow>(sql).all(...orParams);
      return orRows.map((r) => ({ id: r.id, score: normalizeBm25(r.rank) * 0.8 }));
    }

    return results;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`FTS5 query failed: ${message}`);
  }
}

function exactSearch(
  db: Database.Database,
  input: MemorySearchInput,
  limit: number
): Array<{ id: string; score: number }> {
  const conditions: string[] = ["content LIKE ?"];
  const params: unknown[] = [`%${input.query}%`];

  if (!input.include_superseded) {
    conditions.push("superseded_by IS NULL");
  }

  // Exclude expired memories
  conditions.push("(expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))");

  if (input.layers && input.layers.length > 0) {
    const placeholders = input.layers.map(() => "?").join(", ");
    conditions.push(`layer IN (${placeholders})`);
    params.push(...input.layers);
  }

  if (input.entity_name) {
    conditions.push("entity_name = ?");
    params.push(input.entity_name);
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

  params.push(limit);

  const sql = `
    SELECT id FROM memories
    WHERE ${conditions.join(" AND ")}
    ORDER BY importance DESC, confidence DESC
    LIMIT ?
  `;

  const rows = db.prepare<unknown[], { id: string }>(sql).all(...params);
  // Exact match gets a fixed score of 1.0
  return rows.map((r) => ({ id: r.id, score: 1.0 }));
}

/** JSON Schema for MCP tool registration */
export const memorySearchSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search query — free text, tokenized for FTS5",
    },
    layers: {
      type: "array",
      items: {
        type: "string",
        enum: ["episodic", "semantic", "procedural", "resource"],
      },
      description: "Filter by memory layers (default: all layers)",
    },
    entity_name: {
      type: "string",
      description: "Filter by entity name (exact match)",
    },
    scope: {
      type: "string",
      description: "Filter by scope (exact match)",
    },
    date_from: {
      type: "string",
      description: "Filter by event date (event_at if set, else created_at) >= ISO 8601 datetime",
    },
    date_to: {
      type: "string",
      description: "Filter by event date (event_at if set, else created_at) <= ISO 8601 datetime",
    },
    min_confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Minimum confidence threshold",
    },
    min_importance: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Minimum importance threshold",
    },
    include_superseded: {
      type: "boolean",
      description: "Include superseded (outdated) memories in results (default false)",
    },
    limit: {
      type: "number",
      description: "Maximum results to return (default 10)",
    },
    mode: {
      type: "string",
      enum: ["fts", "exact", "hybrid"],
      description: "Search mode: fts=FTS5 tokenized (default), exact=LIKE substring, hybrid=alias for fts (semantic re-ranking reserved for future)",
    },
  },
  required: ["query"],
} as const;
