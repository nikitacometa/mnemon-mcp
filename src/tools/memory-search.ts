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

/** Escape FTS5 special characters and trailing punctuation to prevent syntax errors */
function escapeFtsToken(token: string): string {
  // Remove FTS5 query syntax chars + general punctuation from natural language queries
  // Note: hyphens (-) NOT stripped — unicode61 tokenizer uses them as separators
  return token.replace(/["^*():?!.,;—–\/]/g, "").replace(/\b(AND|OR|NOT|NEAR)\b/gi, "");
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
  // Split on whitespace AND em/en-dash so "феврале–марте" → two tokens
  const rawTokens = query
    .trim()
    .split(/[\s\u2013\u2014\u2015—–]+/)
    .filter((t) => t.length > 0);

  // Filter stop words. Strip trailing punctuation before lookup so "Никиты?" → "никиты"
  const normalizeForStopword = (t: string): string =>
    t.replace(/[?!.,;:—–\u2014\u2013]+$/, "").toLowerCase();
  const contentTokens = rawTokens.filter((t) => {
    const norm = normalizeForStopword(t);
    // Drop stop words
    if (isStopWord(norm)) return false;
    // Drop single chars and 1-2 digit standalone numbers (e.g. "1", "03")
    if (norm.length <= 1) return false;
    if (/^\d{1,2}$/.test(norm)) return false;
    return true;
  });
  const effectiveTokens = contentTokens.length > 0 ? contentTokens : rawTokens;

  const ftsTokens = effectiveTokens
    .map((t) => {
      const escaped = escapeFtsToken(t);
      if (!escaped) return "";
      // Stem the token for better morphological matching
      // e.g. "субличностях" → stem "субличн" → "субличн"* matches "субличность"
      const stemmed = stemWord(escaped);
      // Use the shorter of stemmed/original for prefix matching (wider recall).
      // If stem is ≥3 chars, use stem* for morphological coverage.
      // If stem is too short (e.g. "Юля"→"юл"), fall back to escaped* if escaped ≥3.
      // This ensures short proper names like "Юле" still get prefix matching.
      const stem = stemmed.length < escaped.length ? stemmed : escaped;
      if (stem.length >= 3) {
        return `"${stem}"*`;
      }
      if (escaped.length >= 3) {
        return `"${escaped}"*`;
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

/**
 * Ebbinghaus decay — layer-specific half-lives.
 * Semantic and procedural memories do NOT decay (facts and rules don't "forget").
 * Episodic decays at 30-day half-life, resource at 90 days.
 */
const DECAY_HALF_LIFE_DAYS: Record<Layer, number | null> = {
  episodic: 30,
  resource: 90,
  semantic: null,
  procedural: null,
};

function decayFactor(layer: Layer, referenceDate: string): number {
  const halfLife = DECAY_HALF_LIFE_DAYS[layer];
  if (halfLife === null) return 1.0;
  const daysSince = (Date.now() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 0) return 1.0;
  return Math.exp(-Math.LN2 * daysSince / halfLife);
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
  last_accessed: string | null;
  superseded_by: string | null;
}

export function memorySearch(
  db: Database.Database,
  input: MemorySearchInput
): MemorySearchOutput {
  const startMs = Date.now();
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = input.offset ?? 0;
  const mode = input.mode ?? "fts";

  let ids: Array<{ id: string; score: number }>;

  if (mode === "exact") {
    ids = exactSearch(db, input, limit + offset);
  } else {
    ids = ftsSearch(db, input, limit + offset);
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
              confidence, importance, scope, created_at, event_at,
              last_accessed, superseded_by
       FROM memories
       WHERE id IN (${placeholders})`
    )
    .all(...idList);

  // Map back scores, boost by importance and decay for ranking
  // Formula: final_score = bm25_score * (0.3 + 0.7 * importance) * decay(layer, age)
  // Importance range 0.3–1.0 (wider than old 0.5–1.0)
  // Decay: episodic/resource decay over time, semantic/procedural don't decay
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
      const importanceBoost = 0.3 + 0.7 * row.importance;
      const decay = decayFactor(row.layer as Layer, row.last_accessed ?? row.created_at);
      return {
      id: row.id,
      layer: row.layer as Layer,
      title: row.title,
      content: row.content,
      snippet: makeSnippet(row.content),
      score: bm25Score * importanceBoost * decay,
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
    .slice(offset, offset + limit);

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

  // Field weights for bm25(): title=3x, content=1x, entity_name=2x
  // Reduced title boost to prevent false positives when common words appear in titles
  const sql = `
    SELECT fts.id, bm25(memories_fts, 3.0, 1.0, 2.0) AS rank
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

    // Supplement with OR results when AND returns fewer than limit results.
    // This fills the result set when AND is too restrictive (misses partial matches).
    if (results.length < limit && input.query.trim().split(/\s+/).length > 1) {
      const orQuery = buildFtsQuery(input.query, "OR");
      const orParams = [orQuery, ...params.slice(1)];
      const orRows = db.prepare<unknown[], FtsRow>(sql).all(...orParams);
      const andIds = new Set(results.map((r) => r.id));
      const orOnly = orRows
        .filter((r) => !andIds.has(r.id))
        .map((r) => ({ id: r.id, score: normalizeBm25(r.rank) * 0.8 }));
      return [...results, ...orOnly];
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
  const escaped = input.query.replace(/%/g, "\\%").replace(/_/g, "\\_");
  const conditions: string[] = ["content LIKE ? ESCAPE '\\'"];
  const params: unknown[] = [`%${escaped}%`];

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
    offset: {
      type: "number",
      description: "Number of results to skip (for pagination, default 0)",
    },
    mode: {
      type: "string",
      enum: ["fts", "exact"],
      description: "Search mode: fts=FTS5 tokenized (default), exact=LIKE substring",
    },
  },
  required: ["query"],
} as const;
