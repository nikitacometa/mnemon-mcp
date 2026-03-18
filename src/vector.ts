/**
 * sqlite-vec integration for optional vector search.
 *
 * sqlite-vec is loaded dynamically — if not installed, vector features are
 * silently disabled. All functions check `isVecLoaded()` before operating.
 */

import type Database from "better-sqlite3";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Track the db instance that has sqlite-vec loaded.
// Single-db assumption holds for MCP (one server = one db).
let vecDb: Database.Database | null = null;

/**
 * Try to load sqlite-vec extension into the database connection.
 * Returns true if loaded, false if extension not available.
 */
export function loadSqliteVec(db: Database.Database): boolean {
  try {
    const sqliteVec = require("sqlite-vec") as {
      load: (db: Database.Database) => void;
    };
    sqliteVec.load(db);
    vecDb = db;
    return true;
  } catch {
    vecDb = null;
    return false;
  }
}

export function isVecLoaded(): boolean {
  return vecDb !== null;
}

/**
 * Create the vec0 virtual table for memory embeddings.
 * Must be called after loadSqliteVec() succeeds.
 */
export function createVecTable(db: Database.Database, dimensions: number): void {
  if (!vecDb) return;
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
      memory_id TEXT PRIMARY KEY,
      content_embedding float[${dimensions}] distance_metric=cosine
    )
  `);
}

/** Insert or replace a vector for a memory. */
export function upsertVec(
  db: Database.Database,
  memoryId: string,
  embedding: Float32Array
): void {
  if (!vecDb) return;
  db.prepare(
    "INSERT OR REPLACE INTO memories_vec(memory_id, content_embedding) VALUES (?, ?)"
  ).run(memoryId, embedding);
}

/** Delete a vector when a memory is deleted. */
export function deleteVec(db: Database.Database, memoryId: string): void {
  if (!vecDb) return;
  db.prepare("DELETE FROM memories_vec WHERE memory_id = ?").run(memoryId);
}

/** KNN search — returns memory IDs sorted by cosine similarity (ascending distance). */
export function knnSearch(
  db: Database.Database,
  queryVec: Float32Array,
  k: number,
  excludeSuperseded: boolean = true
): Array<{ memory_id: string; distance: number }> {
  if (!vecDb) return [];

  if (excludeSuperseded) {
    return db
      .prepare<
        [Float32Array, number],
        { memory_id: string; distance: number }
      >(
        `SELECT v.memory_id, v.distance
         FROM memories_vec v
         JOIN memories m ON m.id = v.memory_id
         WHERE v.content_embedding MATCH ?
           AND k = ?
           AND m.superseded_by IS NULL
         ORDER BY v.distance`
      )
      .all(queryVec, k);
  }

  return db
    .prepare<
      [Float32Array, number],
      { memory_id: string; distance: number }
    >(
      `SELECT memory_id, distance
       FROM memories_vec
       WHERE content_embedding MATCH ?
         AND k = ?
       ORDER BY distance`
    )
    .all(queryVec, k);
}

/** Check how many memories have embeddings. */
export function vecCount(db: Database.Database): number {
  if (!vecDb) return 0;
  try {
    const row = db.prepare<[], { cnt: number }>(
      "SELECT count(*) as cnt FROM memories_vec"
    ).get();
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}
