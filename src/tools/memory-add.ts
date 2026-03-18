/**
 * memory_add — insert a new memory into the unified memories table.
 *
 * Auto-detects if the same source_file was previously imported and supersedes
 * the existing entry when content differs significantly.
 */

import type Database from "better-sqlite3";
import type { Layer, MemoryAddInput, MemoryAddOutput, MemoryRow } from "../types.js";
import { generateId, insertMemory } from "./utils.js";
import { stemWord } from "../stemmer.js";
import { isStopWord } from "../stop-words.js";

function computeExpiresAt(ttlDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + ttlDays);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Insert a memory record.
 * If source_file is provided and a non-superseded record with the same
 * source_file exists, the old record is superseded by the new one.
 */
export function memoryAdd(
  db: Database.Database,
  input: MemoryAddInput
): MemoryAddOutput {
  const id = generateId();

  const expires_at =
    input.ttl_days !== undefined ? computeExpiresAt(input.ttl_days) : null;

  const metaJson = input.meta !== undefined ? JSON.stringify(input.meta) : "{}";

  // Find existing active records for the same source_file (if provided)
  const supersededIds: string[] = [];

  if (input.source_file) {
    const stmt = db.prepare<[string], Pick<MemoryRow, "id">>(
      `SELECT id FROM memories
       WHERE source_file = ?
         AND superseded_by IS NULL`
    );
    const existing = stmt.all(input.source_file);
    supersededIds.push(...existing.map((r) => r.id));
  }

  // Validate session_id exists if provided
  if (input.session_id) {
    const session = db.prepare<[string], { id: string }>(
      `SELECT id FROM sessions WHERE id = ?`
    ).get(input.session_id);
    if (!session) {
      throw new Error(`Session not found: ${input.session_id}`);
    }
  }

  const actor = input.source ?? "api";

  // Run insert + supersede chain in a single transaction
  const run = db.transaction(() => {
    insertMemory(db, {
      id,
      layer: input.layer,
      content: input.content,
      title: input.title ?? null,
      source: actor,
      source_file: input.source_file ?? null,
      session_id: input.session_id ?? null,
      event_at: input.event_at ?? null,
      expires_at,
      confidence: input.confidence ?? 0.8,
      importance: input.importance ?? 0.5,
      supersedes: supersededIds.length > 0 ? (supersededIds[supersededIds.length - 1] ?? null) : null,
      entity_type: input.entity_type ?? null,
      entity_name: input.entity_name ?? null,
      scope: input.scope ?? "global",
      meta: metaJson,
      valid_from: input.valid_from ?? null,
      valid_until: input.valid_until ?? null,
    });

    db.prepare(
      `INSERT INTO event_log (memory_id, event_type, actor, old_content, new_content)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, "created", actor, null, input.content);

    if (supersededIds.length > 1) {
      process.stderr.write(
        `[mnemon-mcp] warning: source_file "${input.source_file}" matched ${supersededIds.length} active records (superseding all)\n`
      );
    }

    for (const oldId of supersededIds) {
      db.prepare(
        `UPDATE memories SET superseded_by = ? WHERE id = ?`
      ).run(id, oldId);

      db.prepare(
        `INSERT INTO event_log (memory_id, event_type, actor, old_content, new_content)
         VALUES (?, ?, ?, ?, ?)`
      ).run(oldId, "superseded", actor, null, null);
    }
  });

  run();

  const result: MemoryAddOutput = {
    id,
    layer: input.layer as Layer,
    created: true,
  };

  if (supersededIds.length > 0) {
    result.superseded_ids = supersededIds;
  }

  // Contradiction detection: find existing memories for the same entity with similar content
  if (input.entity_name) {
    const conflicts = findPotentialConflicts(db, input.entity_name, input.content, id);
    if (conflicts.length > 0) {
      result.potential_conflicts = conflicts;
    }
  }

  return result;
}

/**
 * Find existing active memories for the same entity that share content tokens.
 * Uses FTS search with OR-mode on key tokens from the new content, filtered by entity_name.
 * Returns potential conflicts (topically similar memories) — non-blocking, advisory only.
 */
function findPotentialConflicts(
  db: Database.Database,
  entityName: string,
  newContent: string,
  excludeId: string
): Array<{ id: string; snippet: string }> {
  const tokens = newContent
    .split(/[\s\u2013\u2014\u2015—–]+/)
    .map(t => t.replace(/[.,;:!?"'()]/g, "").toLowerCase())
    .filter(t => t.length >= 3 && !isStopWord(t))
    .slice(0, 5);

  if (tokens.length === 0) return [];

  const ftsTokens = tokens
    .map(t => {
      const stemmed = stemWord(t);
      return stemmed.length >= 3 ? `"${stemmed}"*` : `"${t}"`;
    })
    .join(" OR ");

  try {
    const rows = db.prepare<[string, string, string], { id: string; content: string }>(
      `SELECT m.id, m.content
       FROM memories_fts fts
       JOIN memories m ON fts.id = m.id
       WHERE memories_fts MATCH ?
         AND m.entity_name = ?
         AND m.superseded_by IS NULL
         AND m.id != ?
       LIMIT 3`
    ).all(ftsTokens, entityName, excludeId);

    return rows.map(r => ({
      id: r.id,
      snippet: r.content.length > 150 ? r.content.slice(0, 150) + "…" : r.content,
    }));
  } catch {
    return [];
  }
}

