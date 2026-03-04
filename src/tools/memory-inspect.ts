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

interface LayerCountRow {
  layer: string;
  total: number;
  active: number;
  superseded: number;
  avg_confidence: number;
}

interface EntityCountRow {
  entity_name: string | null;
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
      `SELECT * FROM memories WHERE id = ?`
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
        `SELECT * FROM memories WHERE id = ?`
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
         AVG(CASE WHEN superseded_by IS NULL THEN confidence ELSE NULL END) AS avg_confidence
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
      top_entities: [],
    });
  }

  // Fetch top entities per layer (up to 5 each)
  for (const layer of LAYERS) {
    const entityParams: unknown[] = [layer];
    if (input.entity_name) entityParams.push(input.entity_name);

    const entityRows = db
      .prepare<unknown[], EntityCountRow>(
        `SELECT entity_name, COUNT(*) AS cnt
         FROM memories
         WHERE layer = ?
           AND superseded_by IS NULL
           AND entity_name IS NOT NULL
           ${input.entity_name ? "AND entity_name = ?" : ""}
         GROUP BY entity_name
         ORDER BY cnt DESC
         LIMIT 5`
      )
      .all(...entityParams);

    const stat = statsMap.get(layer);
    if (stat) {
      stat.top_entities = entityRows
        .filter((r): r is EntityCountRow & { entity_name: string } => r.entity_name !== null)
        .map((r) => ({ entity_name: r.entity_name, count: r.cnt }));
    }
  }

  const layer_stats = Object.fromEntries(statsMap) as Record<Layer, LayerStat>;

  return { layer_stats };
}

/** JSON Schema for MCP tool registration */
export const memoryInspectSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description:
        "Memory ID to inspect. When provided, returns the full memory row and optionally its history chain.",
    },
    layer: {
      type: "string",
      enum: ["episodic", "semantic", "procedural", "resource"],
      description: "Filter layer stats by this layer (used when id is omitted)",
    },
    entity_name: {
      type: "string",
      description: "Filter stats by entity name (used when id is omitted)",
    },
    include_history: {
      type: "boolean",
      description:
        "When true and id is provided, include the full superseded chain (ancestor entries)",
    },
  },
  required: [],
} as const;
