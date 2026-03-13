/**
 * memory_delete — permanently remove a memory and clean up superseding chain references.
 *
 * If the deleted memory superseded another, the predecessor becomes active again.
 * If the deleted memory was superseded by another, the successor's chain is updated.
 */

import type Database from "better-sqlite3";
import type { MemoryDeleteInput, MemoryDeleteOutput } from "../types.js";

interface DeleteLookupRow {
  id: string;
  content: string;
  source: string;
  supersedes: string | null;
  superseded_by: string | null;
}

export function memoryDelete(
  db: Database.Database,
  input: MemoryDeleteInput
): MemoryDeleteOutput {
  const existing = db
    .prepare<[string], DeleteLookupRow>(
      `SELECT id, content, source, supersedes, superseded_by
       FROM memories WHERE id = ?`
    )
    .get(input.id);

  if (!existing) {
    throw new Error(`Memory not found: ${input.id}`);
  }

  const run = db.transaction(() => {
    // If this memory has both a predecessor and a successor (middle of chain A→B→C),
    // link them together: C.supersedes = A, A.superseded_by = C
    if (existing.supersedes && existing.superseded_by) {
      db.prepare(
        `UPDATE memories SET superseded_by = ? WHERE id = ?`
      ).run(existing.superseded_by, existing.supersedes);
      db.prepare(
        `UPDATE memories SET supersedes = ? WHERE id = ?`
      ).run(existing.supersedes, existing.superseded_by);
    }
    // If this memory only has a predecessor (tail of chain), re-activate it
    else if (existing.supersedes) {
      db.prepare(
        `UPDATE memories SET superseded_by = NULL WHERE id = ?`
      ).run(existing.supersedes);
    }
    // If this memory only has a successor, clear the successor's supersedes link
    else if (existing.superseded_by) {
      db.prepare(
        `UPDATE memories SET supersedes = NULL WHERE id = ?`
      ).run(existing.superseded_by);
    }

    // Log deletion in event_log
    db.prepare(
      `INSERT INTO event_log (memory_id, event_type, actor, old_content)
       VALUES (?, 'deleted', ?, ?)`
    ).run(input.id, existing.source, existing.content);

    // Delete the memory (FTS5 DELETE trigger handles index cleanup)
    db.prepare(`DELETE FROM memories WHERE id = ?`).run(input.id);
  });

  run();

  return { deleted_id: input.id };
}

/** JSON Schema for MCP tool registration */
export const memoryDeleteSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description: "ID of the memory to permanently delete",
    },
  },
  required: ["id"],
} as const;
