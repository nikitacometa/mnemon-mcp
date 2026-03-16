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
import type { Embedder } from "../embedder.js";
import { isStopWord } from "../stop-words.js";
import { stemWord } from "../stemmer.js";
import { knnSearch, isVecLoaded } from "../vector.js";

const DEFAULT_LIMIT = 10;
const SNIPPET_TOKENS = 64;

/** Resolve entity alias to canonical name. Returns the input if no alias exists. */
function resolveEntityName(db: Database.Database, name: string): string {
  const row = db.prepare<[string], { canonical: string }>(
    `SELECT canonical FROM entity_aliases WHERE alias = ?`
  ).get(name);
  return row ? row.canonical : name;
}

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
/** Convert a single token into an FTS5 prefix term: escape, stem, quote */
function tokenToFts(token: string): string {
  const escaped = escapeFtsToken(token);
  if (!escaped) return "";
  const stemmed = stemWord(escaped);
  const stem = stemmed.length < escaped.length ? stemmed : escaped;
  if (stem.length >= 2) return `"${stem}"*`;
  if (escaped.length >= 2) return `"${escaped}"*`;
  return `"${escaped}"`;
}

function buildFtsQuery(query: string, operator: "AND" | "OR" = "AND"): string {
  // Split on whitespace, em/en-dash, AND hyphens (FTS5 unicode61 tokenizes hyphens as separators,
  // so "рэп-архив" must become separate tokens to match the stemmed index)
  const rawTokens = query
    .trim()
    .split(/[\s\u2013\u2014\u2015—–\-]+/)
    .filter((t) => t.length > 0);

  // Filter stop words. Strip trailing punctuation before lookup so "Никиты?" → "никиты"
  const normalizeForStopword = (t: string): string =>
    t.replace(/[?!.,;:—–\u2014\u2013]+$/, "").toLowerCase();
  const contentTokens = rawTokens.filter((t) => {
    const norm = normalizeForStopword(t);
    if (isStopWord(norm)) return false;
    if (norm.length <= 1) return false;
    if (/^\d{1,2}$/.test(norm)) return false;
    return true;
  });
  const effectiveTokens = contentTokens.length > 0 ? contentTokens : rawTokens;

  const ftsTokens = effectiveTokens
    .map(tokenToFts)
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

export async function memorySearch(
  db: Database.Database,
  input: MemorySearchInput,
  embedder?: Embedder | null
): Promise<MemorySearchOutput> {
  const startMs = Date.now();
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = input.offset ?? 0;
  const mode = input.mode ?? "fts";

  let ids: Array<{ id: string; score: number }>;

  if (mode === "vector") {
    if (!embedder) {
      throw new Error("Vector search requires an embedding provider. Set MNEMON_EMBEDDING_PROVIDER env var.");
    }
    if (!isVecLoaded()) {
      throw new Error("Vector search requires sqlite-vec. Install: npm install sqlite-vec");
    }
    ids = await vectorSearch(db, input, embedder, limit + offset);
  } else if (mode === "hybrid") {
    if (!embedder) {
      throw new Error("Hybrid search requires an embedding provider. Set MNEMON_EMBEDDING_PROVIDER env var.");
    }
    if (!isVecLoaded()) {
      throw new Error("Hybrid search requires sqlite-vec. Install: npm install sqlite-vec");
    }
    ids = await hybridSearch(db, input, embedder, limit + offset);
  } else if (mode === "exact") {
    ids = exactSearch(db, input, limit + offset);
  } else {
    ids = ftsSearch(db, input, limit + offset);
  }

  if (ids.length === 0) {
    const queryTimeMs = Date.now() - startMs;
    logSearch(db, input, 0, [], queryTimeMs);
    return { memories: [], total_found: 0, query_time_ms: queryTimeMs };
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

  const queryTimeMs = Date.now() - startMs;

  // Log search query for observability
  logSearch(db, input, memories.length, memories.map((m) => m.id), queryTimeMs);

  return {
    memories,
    total_found: memories.length,
    query_time_ms: queryTimeMs,
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
  } catch (err) {
    throw new Error(`Invalid search query: ${err instanceof Error ? err.message : String(err)}`);
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

  // Resolve entity alias to canonical name
  const resolvedEntity = input.entity_name ? resolveEntityName(db, input.entity_name) : undefined;

  if (resolvedEntity) {
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

  // Temporal fact windows: filter by as_of date (use datetime() for safe comparison)
  if (input.as_of) {
    conditions.push("(m.valid_from IS NULL OR datetime(m.valid_from) <= datetime(?))");
    conditions.push("(m.valid_until IS NULL OR datetime(m.valid_until) >= datetime(?))");
  }

  if (input.min_confidence !== undefined) {
    conditions.push("m.confidence >= ?");
  }

  if (input.min_importance !== undefined) {
    conditions.push("m.importance >= ?");
  }

  const whereClause =
    conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

  // Field weights for bm25(): title=3x, content=1x, entity_name=2x
  const sql = `
    SELECT fts.id, bm25(memories_fts, 3.0, 1.0, 2.0) AS rank
    FROM memories_fts fts
    JOIN memories m ON fts.id = m.id
    WHERE memories_fts MATCH ?
      ${whereClause}
    ORDER BY rank
    LIMIT ?
  `;

  // Build filter params separately from FTS query for clean OR-fallback reuse
  const filterParams: unknown[] = [];
  if (input.layers && input.layers.length > 0) {
    filterParams.push(...input.layers);
  }
  if (resolvedEntity) filterParams.push(resolvedEntity);
  if (input.scope) filterParams.push(input.scope);
  if (input.date_from) filterParams.push(input.date_from);
  if (input.date_to) filterParams.push(input.date_to);
  if (input.as_of) {
    filterParams.push(input.as_of);
    filterParams.push(input.as_of);
  }
  if (input.min_confidence !== undefined) filterParams.push(input.min_confidence);
  if (input.min_importance !== undefined) filterParams.push(input.min_importance);

  const params: unknown[] = [ftsQuery, ...filterParams, limit];

  const runQuery = (matchExpr: string, penalty = 1.0): Array<{ id: string; score: number }> => {
    try {
      const p = [matchExpr, ...filterParams, limit];
      const rows = db.prepare<unknown[], FtsRow>(sql).all(...p);
      return rows.map((r) => ({ id: r.id, score: normalizeBm25(r.rank) * penalty }));
    } catch {
      return [];
    }
  };

  try {
    let results = runQuery(ftsQuery);

    // Progressive AND relaxation: when full AND with 4+ tokens returns too few results,
    // try AND with just the 3 longest (most specific) stems before falling back to OR.
    if (results.length < limit) {
      const contentTokens = ftsQuery.split(/ AND /);
      if (contentTokens.length >= 4) {
        // Sort by stem length descending (longer stems = more specific)
        const top3 = [...contentTokens].sort((a, b) => b.length - a.length).slice(0, 3);
        const relaxedQuery = top3.join(" AND ");
        const relaxedResults = runQuery(relaxedQuery, 0.9);
        const existingIds = new Set(results.map((r) => r.id));
        const newOnly = relaxedResults.filter((r) => !existingIds.has(r.id));
        results = [...results, ...newOnly];
      }
    }

    // Supplement with OR results when AND returns fewer than limit results.
    if (results.length < limit && input.query.trim().split(/[\s\-]+/).length > 1) {
      const orQuery = buildFtsQuery(input.query, "OR");
      const orResults = runQuery(orQuery, 0.8);
      const existingIds = new Set(results.map((r) => r.id));
      const orOnly = orResults.filter((r) => !existingIds.has(r.id));
      results = [...results, ...orOnly];
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
    const resolvedEntity = resolveEntityName(db, input.entity_name);
    conditions.push("entity_name = ?");
    params.push(resolvedEntity);
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

  // Temporal fact windows: filter by as_of date (use datetime() for safe comparison)
  if (input.as_of) {
    conditions.push("(valid_from IS NULL OR datetime(valid_from) <= datetime(?))");
    conditions.push("(valid_until IS NULL OR datetime(valid_until) >= datetime(?))");
    params.push(input.as_of);
    params.push(input.as_of);
  }

  if (input.min_confidence !== undefined) {
    conditions.push("confidence >= ?");
    params.push(input.min_confidence);
  }

  if (input.min_importance !== undefined) {
    conditions.push("importance >= ?");
    params.push(input.min_importance);
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

/**
 * Build SQL filter conditions from search input (shared by vector and hybrid).
 * Returns [conditions[], params[]] to add to a WHERE clause.
 */
function buildMemoryFilters(
  db: Database.Database,
  input: MemorySearchInput
): { conditions: string[]; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (!input.include_superseded) {
    conditions.push("superseded_by IS NULL");
  }
  conditions.push("(expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))");

  if (input.layers && input.layers.length > 0) {
    conditions.push(`layer IN (${input.layers.map(() => "?").join(", ")})`);
    params.push(...input.layers);
  }
  if (input.entity_name) {
    const resolved = resolveEntityName(db, input.entity_name);
    conditions.push("entity_name = ?");
    params.push(resolved);
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
  if (input.as_of) {
    conditions.push("(valid_from IS NULL OR datetime(valid_from) <= datetime(?))");
    conditions.push("(valid_until IS NULL OR datetime(valid_until) >= datetime(?))");
    params.push(input.as_of, input.as_of);
  }
  if (input.min_confidence !== undefined) {
    conditions.push("confidence >= ?");
    params.push(input.min_confidence);
  }
  if (input.min_importance !== undefined) {
    conditions.push("importance >= ?");
    params.push(input.min_importance);
  }

  return { conditions, params };
}

async function vectorSearch(
  db: Database.Database,
  input: MemorySearchInput,
  embedder: Embedder,
  limit: number
): Promise<Array<{ id: string; score: number }>> {
  const queryVec = await embedder.embed(input.query);
  // Over-fetch to account for filter losses
  const knnLimit = Math.min(limit * 3, 200);
  const results = knnSearch(db, queryVec, knnLimit, !input.include_superseded);

  if (results.length === 0) return [];

  // Apply the same filters as FTS/exact search
  const { conditions, params } = buildMemoryFilters(db, input);

  const knnIds = results.map((r) => r.memory_id);
  const idPlaceholders = knnIds.map(() => "?").join(", ");
  const allConditions = [`id IN (${idPlaceholders})`, ...conditions];

  const filtered = db
    .prepare<unknown[], { id: string }>(
      `SELECT id FROM memories WHERE ${allConditions.join(" AND ")}`
    )
    .all(...knnIds, ...params);

  const filteredSet = new Set(filtered.map((r) => r.id));

  return results
    .filter((r) => filteredSet.has(r.memory_id))
    .map((r) => ({ id: r.memory_id, score: Math.max(0, 1 - r.distance) }))
    .slice(0, limit);
}

async function hybridSearch(
  db: Database.Database,
  input: MemorySearchInput,
  embedder: Embedder,
  limit: number
): Promise<Array<{ id: string; score: number }>> {
  // Run FTS and vector search in parallel
  const [ftsResults, vecResults] = await Promise.all([
    Promise.resolve(ftsSearch(db, input, limit)),
    vectorSearch(db, input, embedder, limit),
  ]);

  // Reciprocal Rank Fusion (k=60)
  const RRF_K = 60;
  const scores = new Map<string, number>();

  ftsResults.forEach((r, i) => {
    const rank = i + 1;
    scores.set(r.id, (scores.get(r.id) ?? 0) + 1.0 / (RRF_K + rank));
  });

  vecResults.forEach((r, i) => {
    const rank = i + 1;
    scores.set(r.id, (scores.get(r.id) ?? 0) + 1.0 / (RRF_K + rank));
  });

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Log search query to search_log table for observability. Best-effort, never throws. */
function logSearch(
  db: Database.Database,
  input: MemorySearchInput,
  resultCount: number,
  resultIds: string[],
  queryTimeMs: number
): void {
  try {
    const filters: Record<string, unknown> = {};
    if (input.layers) filters.layers = input.layers;
    if (input.entity_name) filters.entity_name = input.entity_name;
    if (input.scope) filters.scope = input.scope;
    if (input.date_from) filters.date_from = input.date_from;
    if (input.date_to) filters.date_to = input.date_to;
    if (input.as_of) filters.as_of = input.as_of;
    if (input.min_confidence !== undefined) filters.min_confidence = input.min_confidence;
    if (input.min_importance !== undefined) filters.min_importance = input.min_importance;

    db.prepare(
      `INSERT INTO search_log (query, mode, filters, result_count, result_ids, query_time_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      input.query,
      input.mode ?? "fts",
      JSON.stringify(filters),
      resultCount,
      JSON.stringify(resultIds.slice(0, 20)),
      queryTimeMs
    );
  } catch {
    // Best-effort logging — never fail a search because of log write
  }
}

