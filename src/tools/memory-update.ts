/**
 * memory_update — update fields in place or create a superseding entry.
 *
 * When supersede=true: creates a new memory entry that supersedes the old one.
 * The old entry's superseded_by is set to the new entry's ID.
 * When supersede=false (default): directly UPDATE the fields in place.
 */

import type Database from "better-sqlite3";
import type { MemoryUpdateInput, MemoryUpdateOutput } from "../types.js";
import { stemText } from "../stemmer.js";
import { generateId, insertMemory } from "./utils.js";

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
  superseded_by: string | null;
  entity_type: string | null;
  entity_name: string | null;
  scope: string;
  meta: string;
  valid_from: string | null;
  valid_until: string | null;
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
              superseded_by, entity_type, entity_name, scope, meta,
              valid_from, valid_until
       FROM memories WHERE id = ?`
    )
    .get(input.id);

  if (!existing) {
    throw new Error(`Memory not found: ${input.id}`);
  }

  if (input.supersede === true) {
    if (existing.superseded_by !== null) {
      throw new Error(
        `Cannot supersede memory ${input.id}: already superseded by ${existing.superseded_by}`
      );
    }
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
    setClauses.push("stemmed_content = ?");
    params.push(stemText(input.content));
  }

  if (input.title !== undefined) {
    setClauses.push("title = ?");
    params.push(input.title);
    setClauses.push("stemmed_title = ?");
    params.push(stemText(input.title));
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

  const newTitle = input.title ?? existing.title;

  // Don't inherit expired expires_at — superseding entry should not start expired
  const expiresAt =
    existing.expires_at && new Date(existing.expires_at) > new Date()
      ? existing.expires_at
      : null;

  const run = db.transaction(() => {
    insertMemory(db, {
      id: newId,
      layer: existing.layer,
      content: newContent,
      title: newTitle,
      source: existing.source,
      source_file: existing.source_file,
      session_id: existing.session_id,
      event_at: existing.event_at,
      expires_at: expiresAt,
      confidence: input.confidence ?? existing.confidence,
      importance: input.importance ?? existing.importance,
      supersedes: existing.id,
      entity_type: existing.entity_type,
      entity_name: existing.entity_name,
      scope: existing.scope,
      meta: metaJson,
      valid_from: existing.valid_from,
      valid_until: existing.valid_until,
    });

    // Mark the old entry as superseded
    db.prepare(
      `UPDATE memories SET superseded_by = ? WHERE id = ?`
    ).run(newId, existing.id);

    db.prepare(`
      INSERT INTO event_log (memory_id, event_type, actor, old_content, new_content)
      VALUES (?, ?, ?, ?, ?)
    `).run(existing.id, "superseded", existing.source, existing.content, null);

    db.prepare(`
      INSERT INTO event_log (memory_id, event_type, actor, old_content, new_content)
      VALUES (?, ?, ?, ?, ?)
    `).run(newId, "created", existing.source, null, newContent);
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
