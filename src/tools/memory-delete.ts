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
    // Re-activate predecessor if this memory superseded it
    if (existing.supersedes) {
      db.prepare(
        `UPDATE memories SET superseded_by = NULL WHERE id = ?`
      ).run(existing.supersedes);
    }

    // Update successor's supersedes reference if this memory was superseded
    if (existing.superseded_by) {
      db.prepare(
        `UPDATE memories SET supersedes = ? WHERE id = ?`
      ).run(existing.supersedes, existing.superseded_by);
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

  return { deleted_id: input.id, deleted: true };
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
