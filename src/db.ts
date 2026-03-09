/**
 * SQLite database setup, migrations, and schema creation.
 * Uses better-sqlite3 for synchronous access — ideal for MCP stdio transport.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_DIR = join(homedir(), ".persona-mcp");
const DB_PATH = join(DB_DIR, "memory.db");

/**
 * Open (or create) the SQLite database with WAL mode and all required tables.
 * Idempotent — safe to call on every server startup.
 */
export function openDatabase(dbPath: string = DB_PATH): Database.Database {
  mkdirSync(DB_DIR, { recursive: true });

  const db = new Database(dbPath);

  // WAL mode: better concurrent read performance, atomic writes
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    -- =========================================================
    -- sessions: track agent sessions for episodic context
    -- =========================================================
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      client     TEXT NOT NULL,
      project    TEXT,
      started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      ended_at   TEXT,
      summary    TEXT,
      meta       TEXT NOT NULL DEFAULT '{}'
    );

    -- =========================================================
    -- memories: unified 4-layer memory table
    -- =========================================================
    CREATE TABLE IF NOT EXISTS memories (
      id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      layer         TEXT NOT NULL CHECK (layer IN ('episodic', 'semantic', 'procedural', 'resource')),
      content       TEXT NOT NULL,
      title         TEXT,
      source        TEXT NOT NULL,
      source_file   TEXT,
      session_id    TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      event_at      TEXT,
      expires_at    TEXT,
      confidence    REAL NOT NULL DEFAULT 0.8 CHECK (confidence BETWEEN 0.0 AND 1.0),
      importance    REAL NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0.0 AND 1.0),
      access_count  INTEGER NOT NULL DEFAULT 0,
      last_accessed TEXT,
      superseded_by TEXT REFERENCES memories(id) ON DELETE SET NULL,
      supersedes    TEXT REFERENCES memories(id) ON DELETE SET NULL,
      entity_type   TEXT CHECK (entity_type IN ('user','project','person','concept','file','rule','tool') OR entity_type IS NULL),
      entity_name   TEXT,
      scope         TEXT NOT NULL DEFAULT 'global',
      embedding     BLOB,
      meta          TEXT NOT NULL DEFAULT '{}'
    );

    -- =========================================================
    -- import_log: track file import history for deduplication
    -- =========================================================
    CREATE TABLE IF NOT EXISTS import_log (
      id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      source_path       TEXT NOT NULL,
      source_type       TEXT NOT NULL CHECK (source_type IN ('claude-md','kb-markdown','json','chatgpt-export')),
      imported_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      memories_created  INTEGER NOT NULL DEFAULT 0,
      memories_updated  INTEGER NOT NULL DEFAULT 0,
      file_hash         TEXT,
      status            TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','partial','failed')),
      errors            TEXT NOT NULL DEFAULT '[]'
    );

    -- =========================================================
    -- event_log: append-only audit trail for all memory mutations
    -- =========================================================
    CREATE TABLE IF NOT EXISTS event_log (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      memory_id   TEXT NOT NULL,
      event_type  TEXT NOT NULL CHECK (event_type IN ('created', 'updated', 'superseded')),
      actor       TEXT NOT NULL DEFAULT 'api',
      old_content TEXT,
      new_content TEXT,
      diff_meta   TEXT NOT NULL DEFAULT '{}',
      occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_event_log_memory
      ON event_log(memory_id);

    CREATE INDEX IF NOT EXISTS idx_event_log_occurred
      ON event_log(occurred_at DESC);

    -- =========================================================
    -- FTS5: full-text search across title, content, entity_name
    -- Standalone (not content=) for simpler trigger-based sync
    -- unicode61 tokenizer: Cyrillic + Thai support
    -- =========================================================
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      id UNINDEXED,
      title,
      content,
      entity_name,
      tokenize='unicode61 remove_diacritics 2'
    );

    -- =========================================================
    -- Partial indexes — superseded entries excluded from search
    -- =========================================================
    CREATE INDEX IF NOT EXISTS idx_memories_layer
      ON memories(layer)
      WHERE superseded_by IS NULL;

    CREATE INDEX IF NOT EXISTS idx_memories_entity
      ON memories(entity_type, entity_name)
      WHERE superseded_by IS NULL;

    CREATE INDEX IF NOT EXISTS idx_memories_event_at
      ON memories(event_at)
      WHERE layer = 'episodic' AND event_at IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_memories_expires
      ON memories(expires_at)
      WHERE expires_at IS NOT NULL AND superseded_by IS NULL;

    CREATE INDEX IF NOT EXISTS idx_memories_scope
      ON memories(scope, layer)
      WHERE superseded_by IS NULL;

    CREATE INDEX IF NOT EXISTS idx_memories_rank
      ON memories(importance DESC, confidence DESC)
      WHERE superseded_by IS NULL;

    CREATE INDEX IF NOT EXISTS idx_memories_source_file
      ON memories(source_file)
      WHERE source_file IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_memories_session
      ON memories(session_id)
      WHERE session_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_import_log_hash
      ON import_log(source_path, file_hash)
      WHERE file_hash IS NOT NULL;

    -- =========================================================
    -- FTS5 sync triggers
    -- =========================================================
    CREATE TRIGGER IF NOT EXISTS memories_fts_insert
    AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(id, title, content, entity_name)
      VALUES (NEW.id, NEW.title, NEW.content, NEW.entity_name);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_update
    AFTER UPDATE ON memories BEGIN
      UPDATE memories_fts
      SET title       = NEW.title,
          content     = NEW.content,
          entity_name = NEW.entity_name
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_delete
    AFTER DELETE ON memories BEGIN
      DELETE FROM memories_fts WHERE id = OLD.id;
    END;

    -- =========================================================
    -- Auto-update updated_at on memories modification
    -- =========================================================
    CREATE TRIGGER IF NOT EXISTS memories_updated_at
    AFTER UPDATE ON memories
    WHEN OLD.updated_at = NEW.updated_at BEGIN
      UPDATE memories SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = NEW.id;
    END;
  `);
}

export { DB_PATH };
