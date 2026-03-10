/**
 * memory_add — insert a new memory into the unified memories table.
 *
 * Auto-detects if the same source_file was previously imported and supersedes
 * the existing entry when content differs significantly.
 */

import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import type { Layer, MemoryAddInput, MemoryAddOutput, MemoryRow } from "../types.js";

function generateId(): string {
  return randomBytes(16).toString("hex");
}

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

  const updateSuperseded = db.prepare(`
    UPDATE memories SET superseded_by = ? WHERE id = ?
  `);

  const logEvent = db.prepare(`
    INSERT INTO event_log (memory_id, event_type, actor, old_content, new_content)
    VALUES (?, ?, ?, ?, ?)
  `);

  const actor = input.source ?? "api";

  // Run insert + supersede chain in a single transaction
  const run = db.transaction(() => {
    insertStmt.run(
      id,
      input.layer,
      input.content,
      input.title ?? null,
      actor,
      input.source_file ?? null,
      input.session_id ?? null,
      input.event_at ?? null,
      expires_at,
      input.confidence ?? 0.8,
      input.importance ?? 0.5,
      supersededIds.length > 0 ? (supersededIds[supersededIds.length - 1] ?? null) : null,
      input.entity_type ?? null,
      input.entity_name ?? null,
      input.scope ?? "global",
      metaJson
    );

    logEvent.run(id, "created", actor, null, input.content);

    for (const oldId of supersededIds) {
      updateSuperseded.run(id, oldId);
      logEvent.run(oldId, "superseded", actor, null, null);
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

  return result;
}

/** JSON Schema for MCP tool registration */
export const memoryAddSchema = {
  type: "object",
  properties: {
    content: {
      type: "string",
      description: "The memory content to store",
    },
    layer: {
      type: "string",
      enum: ["episodic", "semantic", "procedural", "resource"],
      description:
        "Cognitive layer: episodic=events/sessions, semantic=facts/concepts, procedural=rules/workflows, resource=reference material",
    },
    title: {
      type: "string",
      description: "Optional short title for the memory",
    },
    entity_type: {
      type: "string",
      enum: ["user", "project", "person", "concept", "file", "rule", "tool"],
      description: "Entity this memory is about",
    },
    entity_name: {
      type: "string",
      description: "Name of the entity (e.g. 'nikita', 'mnemon-mcp')",
    },
    event_at: {
      type: "string",
      description: "ISO 8601 datetime when the event occurred (episodic layer)",
    },
    ttl_days: {
      type: "number",
      description: "Days until this memory expires (null = never)",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "How certain this memory is (0.0–1.0, default 0.8)",
    },
    importance: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Retrieval priority weight (0.0–1.0, default 0.5)",
    },
    scope: {
      type: "string",
      description: "Project/context scope (default 'global')",
    },
    source: {
      type: "string",
      description: "Source identifier (e.g. 'claude-code', 'api')",
    },
    source_file: {
      type: "string",
      description: "Original file path for imports",
    },
    session_id: {
      type: "string",
      description: "Session ID to associate with this memory",
    },
    meta: {
      type: "object",
      description: "Additional metadata (layer-specific fields)",
    },
  },
  required: ["content", "layer"],
} as const;
