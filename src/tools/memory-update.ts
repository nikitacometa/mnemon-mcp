/**
 * memory_update — update fields in place or create a superseding entry.
 *
 * When supersede=true: creates a new memory entry that supersedes the old one.
 * The old entry's superseded_by is set to the new entry's ID.
 * When supersede=false (default): directly UPDATE the fields in place.
 */

import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import type { Layer, MemoryRow, MemoryUpdateInput, MemoryUpdateOutput } from "../types.js";

function generateId(): string {
  return randomBytes(16).toString("hex");
}

interface MemoryLookupRow {
  id: string;
  layer: string;
  content: string;
  title: string | null;
  source: string;
  source_file: string | null;
  session_id: string | null;
  event_at: string | null;
  expires_at: string | null;
  confidence: number;
  importance: number;
  supersedes: string | null;
  entity_type: string | null;
  entity_name: string | null;
  scope: string;
  meta: string;
}

export function memoryUpdate(
  db: Database.Database,
  input: MemoryUpdateInput
): MemoryUpdateOutput {
  // Fetch existing record
  const existing = db
    .prepare<[string], MemoryLookupRow>(
      `SELECT id, layer, content, title, source, source_file, session_id,
              event_at, expires_at, confidence, importance, supersedes,
              entity_type, entity_name, scope, meta
       FROM memories WHERE id = ?`
    )
    .get(input.id);

  if (!existing) {
    throw new Error(`Memory not found: ${input.id}`);
  }

  if (input.supersede === true) {
    return createSupersedingEntry(db, existing, input);
  }

  return updateInPlace(db, existing, input);
}

function updateInPlace(
  db: Database.Database,
  existing: MemoryLookupRow,
  input: MemoryUpdateInput
): MemoryUpdateOutput {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (input.content !== undefined) {
    setClauses.push("content = ?");
    params.push(input.content);
  }

  if (input.title !== undefined) {
    setClauses.push("title = ?");
    params.push(input.title);
  }

  if (input.confidence !== undefined) {
    setClauses.push("confidence = ?");
    params.push(input.confidence);
  }

  if (input.importance !== undefined) {
    setClauses.push("importance = ?");
    params.push(input.importance);
  }

  if (input.meta !== undefined) {
    // Merge with existing meta
    let existingMeta: Record<string, unknown> = {};
    try {
      existingMeta = JSON.parse(existing.meta) as Record<string, unknown>;
    } catch {
      // existing meta is malformed — start fresh
    }
    const merged = { ...existingMeta, ...input.meta };
    setClauses.push("meta = ?");
    params.push(JSON.stringify(merged));
  }

  if (setClauses.length === 0) {
    // Nothing to update
    return { updated_id: existing.id, superseded: false };
  }

  // updated_at is handled by the trigger, but only when updated_at is NOT
  // being explicitly set. We force a change by touching updated_at ourselves.
  setClauses.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");

  params.push(existing.id);

  const newContent = input.content ?? existing.content;

  const run = db.transaction(() => {
    db.prepare(
      `UPDATE memories SET ${setClauses.join(", ")} WHERE id = ?`
    ).run(...params);

    db.prepare(
      `INSERT INTO event_log (memory_id, event_type, actor, old_content, new_content)
       VALUES (?, 'updated', ?, ?, ?)`
    ).run(existing.id, existing.source, existing.content, newContent);
  });

  run();

  return { updated_id: existing.id, superseded: false };
}

function createSupersedingEntry(
  db: Database.Database,
  existing: MemoryLookupRow,
  input: MemoryUpdateInput
): MemoryUpdateOutput {
  const newId = generateId();
  const newContent = input.new_content ?? input.content ?? existing.content;

  // Merge meta if provided
  let metaJson = existing.meta;
  if (input.meta !== undefined) {
    let existingMeta: Record<string, unknown> = {};
    try {
      existingMeta = JSON.parse(existing.meta) as Record<string, unknown>;
    } catch {
      // start fresh
    }
    metaJson = JSON.stringify({ ...existingMeta, ...input.meta });
  }

  const insertStmt = db.prepare(`
    INSERT INTO memories (
      id, layer, content, title, source, source_file,
      session_id, event_at, expires_at,
      confidence, importance,
      supersedes,
      entity_type, entity_name, scope, meta
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?,
      ?, ?, ?, ?
    )
  `);

  const setSupersededBy = db.prepare(
    `UPDATE memories SET superseded_by = ? WHERE id = ?`
  );

  const logEvent = db.prepare(`
    INSERT INTO event_log (memory_id, event_type, actor, old_content, new_content)
    VALUES (?, ?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    insertStmt.run(
      newId,
      existing.layer,
      newContent,
      input.title ?? existing.title,
      existing.source,
      existing.source_file,
      existing.session_id,
      existing.event_at,
      existing.expires_at,
      input.confidence ?? existing.confidence,
      input.importance ?? existing.importance,
      existing.id, // new entry supersedes the old one
      existing.entity_type,
      existing.entity_name,
      existing.scope,
      metaJson
    );

    // Mark the old entry as superseded
    setSupersededBy.run(newId, existing.id);

    logEvent.run(existing.id, "superseded", existing.source, existing.content, null);
    logEvent.run(newId, "created", existing.source, null, newContent);
  });

  run();

  return {
    updated_id: existing.id,
    new_id: newId,
    superseded: true,
  };
}

/** JSON Schema for MCP tool registration */
export const memoryUpdateSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description: "ID of the memory to update",
    },
    content: {
      type: "string",
      description: "New content (used for in-place update or as new_content fallback)",
    },
    title: {
      type: "string",
      description: "New title",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "New confidence score",
    },
    importance: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "New importance score",
    },
    meta: {
      type: "object",
      description: "Metadata fields to merge into existing meta JSON",
    },
    supersede: {
      type: "boolean",
      description:
        "When true, creates a new entry that supersedes this one (preserves history). When false (default), updates fields in place.",
    },
    new_content: {
      type: "string",
      description:
        "Content for the superseding entry (used only when supersede=true). Falls back to `content` if omitted.",
    },
  },
  required: ["id"],
} as const;
