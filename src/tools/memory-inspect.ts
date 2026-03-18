/**
 * memory_inspect — introspect layer stats or trace a memory's superseding chain.
 *
 * Without id: return aggregate stats per layer.
 * With id: return full memory row + superseded_chain (follow supersedes links).
 */

import type Database from "better-sqlite3";
import type {
  Layer,
  LayerStat,
  MemoryInspectInput,
  MemoryInspectOutput,
  MemoryRow,
} from "../types.js";

const LAYERS: Layer[] = ["episodic", "semantic", "procedural", "resource"];

/** Explicit column list matching MemoryRow — prevents leaking internal columns (stemmed_*). */
const MEMORY_COLUMNS = `
  id, layer, content, title, source, source_file, session_id,
  created_at, updated_at, event_at, expires_at,
  confidence, importance, access_count, last_accessed,
  superseded_by, supersedes, entity_type, entity_name,
  scope, meta, valid_from, valid_until, embedding_model
`;

interface LayerCountRow {
  layer: string;
  total: number;
  active: number;
  superseded: number;
  avg_confidence: number;
  never_accessed: number;
  stale_count: number;
  avg_age_days: number;
}

interface EntityCountRow {
  layer: string;
  entity_name: string;
  cnt: number;
}

export function memoryInspect(
  db: Database.Database,
  input: MemoryInspectInput
): MemoryInspectOutput {
  if (input.id) {
    return inspectById(db, input.id, input.include_history ?? false);
  }

  return inspectLayerStats(db, input);
}

function inspectById(
  db: Database.Database,
  id: string,
  includeHistory: boolean
): MemoryInspectOutput {
  const memory = db
    .prepare<[string], MemoryRow>(
      `SELECT ${MEMORY_COLUMNS} FROM memories WHERE id = ?`
    )
    .get(id);

  if (!memory) {
    throw new Error(`Memory not found: ${id}`);
  }

  // Update access tracking
  db.prepare(
    `UPDATE memories
     SET access_count = access_count + 1,
         last_accessed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = ?`
  ).run(id);

  const result: MemoryInspectOutput = { memory };

  if (includeHistory) {
    result.superseded_chain = buildSupersededChain(db, memory);
  }

  return result;
}

/**
 * Follow supersedes links backwards to build the full history chain.
 * Stops at MAX_CHAIN_DEPTH to prevent infinite loops in corrupted data.
 */
function buildSupersededChain(
  db: Database.Database,
  root: MemoryRow,
  maxDepth = 50
): MemoryRow[] {
  const chain: MemoryRow[] = [];
  let currentId: string | null = root.supersedes;
  let depth = 0;

  while (currentId && depth < maxDepth) {
    const row = db
      .prepare<[string], MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM memories WHERE id = ?`
      )
      .get(currentId);

    if (!row) break;

    chain.push(row);
    currentId = row.supersedes;
    depth++;
  }

  return chain;
}

function inspectLayerStats(
  db: Database.Database,
  input: MemoryInspectInput
): MemoryInspectOutput {
  const layerFilter = input.layer ? `AND layer = ?` : "";
  const entityFilter = input.entity_name ? `AND entity_name = ?` : "";

  const statsParams: unknown[] = [];
  if (input.layer) statsParams.push(input.layer);
  if (input.entity_name) statsParams.push(input.entity_name);

  const statsRows = db
    .prepare<unknown[], LayerCountRow>(
      `SELECT
         layer,
         COUNT(*) AS total,
         SUM(CASE WHEN superseded_by IS NULL THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN superseded_by IS NOT NULL THEN 1 ELSE 0 END) AS superseded,
         AVG(CASE WHEN superseded_by IS NULL THEN confidence ELSE NULL END) AS avg_confidence,
         SUM(CASE WHEN superseded_by IS NULL AND access_count = 0 THEN 1 ELSE 0 END) AS never_accessed,
         SUM(CASE WHEN superseded_by IS NULL AND last_accessed IS NOT NULL
           AND julianday('now') - julianday(last_accessed) > 30 THEN 1 ELSE 0 END) AS stale_count,
         AVG(CASE WHEN superseded_by IS NULL
           THEN julianday('now') - julianday(created_at) ELSE NULL END) AS avg_age_days
       FROM memories
       WHERE 1=1 ${layerFilter} ${entityFilter}
       GROUP BY layer`
    )
    .all(...statsParams);

  // Build stats map with defaults for layers that have no records
  const statsMap = new Map<Layer, LayerStat>();

  for (const layer of LAYERS) {
    statsMap.set(layer, {
      total: 0,
      active: 0,
      superseded: 0,
      avg_confidence: 0,
      never_accessed: 0,
      stale_count: 0,
      avg_age_days: 0,
      top_entities: [],
    });
  }

  for (const row of statsRows) {
    const layer = row.layer as Layer;
    statsMap.set(layer, {
      total: row.total,
      active: row.active,
      superseded: row.superseded,
      avg_confidence: row.avg_confidence ?? 0,
      never_accessed: row.never_accessed ?? 0,
      stale_count: row.stale_count ?? 0,
      avg_age_days: Math.round((row.avg_age_days ?? 0) * 10) / 10,
      top_entities: [],
    });
  }

  // Fetch top 5 entities per layer in a single query using window function
  const entityRows = db
    .prepare<unknown[], EntityCountRow>(
      `WITH ranked AS (
        SELECT
          layer,
          entity_name,
          COUNT(*) AS cnt,
          ROW_NUMBER() OVER (PARTITION BY layer ORDER BY COUNT(*) DESC) AS rn
        FROM memories
        WHERE superseded_by IS NULL
          AND entity_name IS NOT NULL
          ${layerFilter} ${entityFilter}
        GROUP BY layer, entity_name
      )
      SELECT layer, entity_name, cnt
      FROM ranked
      WHERE rn <= 5
      ORDER BY layer, cnt DESC`
    )
    .all(...statsParams);

  for (const row of entityRows) {
    const stat = statsMap.get(row.layer as Layer);
    if (stat) {
      stat.top_entities.push({ entity_name: row.entity_name, count: row.cnt });
    }
  }

  const layer_stats = Object.fromEntries(statsMap) as Record<Layer, LayerStat>;

  return { layer_stats };
}

