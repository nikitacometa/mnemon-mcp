/**
 * Shared utilities for memory tools — deduplicates generateId() and INSERT logic.
 */

import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { stemText } from "../stemmer.js";

export function generateId(): string {
  return randomBytes(16).toString("hex");
}

export interface InsertMemoryParams {
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

/** Insert a memory row with automatic index-time stemming. */
export function insertMemory(db: Database.Database, params: InsertMemoryParams): void {
  const stemmedContent = stemText(params.content);
  const stemmedTitle = params.title ? stemText(params.title) : null;

  db.prepare(`
    INSERT INTO memories (
      id, layer, content, title, source, source_file,
      session_id, event_at, expires_at,
      confidence, importance,
      supersedes,
      entity_type, entity_name, scope, meta,
      stemmed_content, stemmed_title
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?,
      ?, ?, ?, ?,
      ?, ?
    )
  `).run(
    params.id, params.layer, params.content, params.title,
    params.source, params.source_file, params.session_id,
    params.event_at, params.expires_at, params.confidence,
    params.importance, params.supersedes, params.entity_type,
    params.entity_name, params.scope, params.meta,
    stemmedContent, stemmedTitle
  );
}
