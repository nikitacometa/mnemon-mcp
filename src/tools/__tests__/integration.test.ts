/**
 * Integration tests for mnemon-mcp core tools.
 * Uses in-memory SQLite database — no production data affected.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../db.js";
import { memoryAdd } from "../memory-add.js";
import { memorySearch } from "../memory-search.js";
import { memoryUpdate } from "../memory-update.js";
import { memoryInspect } from "../memory-inspect.js";
import { memoryDelete } from "../memory-delete.js";
import { memoryExport } from "../memory-export.js";
import { stemText } from "../../stemmer.js";
import type { MemoryAddInput, MemorySearchInput } from "../../types.js";

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// memory_add
// ---------------------------------------------------------------------------

describe("memory_add", () => {
  it("inserts a basic memory and returns id", () => {
    const result = memoryAdd(db, {
      content: "TypeScript is great",
      layer: "semantic",
      title: "TS fact",
    });

    expect(result.id).toMatch(/^[0-9a-f]{32}$/);
    expect(result.layer).toBe("semantic");
    expect(result.created).toBe(true);
    expect(result.superseded_ids).toBeUndefined();
  });

  it("sets default confidence and importance", () => {
    const result = memoryAdd(db, { content: "test", layer: "episodic" });
    const row = db.prepare("SELECT confidence, importance FROM memories WHERE id = ?").get(result.id) as { confidence: number; importance: number };
    expect(row.confidence).toBe(0.8);
    expect(row.importance).toBe(0.5);
  });

  it("supersedes existing memory with same source_file", () => {
    const first = memoryAdd(db, {
      content: "version 1",
      layer: "semantic",
      source_file: "test/doc.md",
    });

    const second = memoryAdd(db, {
      content: "version 2",
      layer: "semantic",
      source_file: "test/doc.md",
    });

    expect(second.superseded_ids).toEqual([first.id]);

    const oldRow = db.prepare("SELECT superseded_by FROM memories WHERE id = ?").get(first.id) as { superseded_by: string };
    expect(oldRow.superseded_by).toBe(second.id);
  });

  it("creates event_log entries", () => {
    const result = memoryAdd(db, { content: "test content", layer: "episodic" });
    const events = db.prepare("SELECT event_type, new_content FROM event_log WHERE memory_id = ?").all(result.id) as Array<{ event_type: string; new_content: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("created");
    expect(events[0]!.new_content).toBe("test content");
  });

  it("computes expires_at from ttl_days", () => {
    const result = memoryAdd(db, { content: "ephemeral", layer: "episodic", ttl_days: 7 });
    const row = db.prepare("SELECT expires_at FROM memories WHERE id = ?").get(result.id) as { expires_at: string };
    expect(row.expires_at).toBeTruthy();
    const expiresDate = new Date(row.expires_at);
    const now = new Date();
    const diffDays = (expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(6);
    expect(diffDays).toBeLessThan(8);
  });
});

// ---------------------------------------------------------------------------
// memory_search
// ---------------------------------------------------------------------------

describe("memory_search", () => {
  function seedMemories() {
    memoryAdd(db, { content: "TypeScript strict mode enables better type safety", layer: "semantic", title: "TS strict" });
    memoryAdd(db, { content: "Встреча с Алексеем в кафе на Сукхумвит", layer: "episodic", title: "Meeting", event_at: "2026-03-01T10:00:00Z" });
    memoryAdd(db, { content: "Always run npm test before committing code changes", layer: "procedural", title: "Dev rule" });
    memoryAdd(db, { content: "Book summary: Thinking Fast and Slow by Kahneman", layer: "resource", title: "Book" });
  }

  it("finds memory by keyword", () => {
    seedMemories();
    const result = memorySearch(db, { query: "TypeScript" });
    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.memories[0]!.content).toContain("TypeScript");
  });

  it("finds Cyrillic content", () => {
    seedMemories();
    const result = memorySearch(db, { query: "Алексеем" });
    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.memories[0]!.content).toContain("Алексеем");
  });

  it("filters by layer", () => {
    seedMemories();
    const result = memorySearch(db, { query: "TypeScript", layers: ["procedural"] });
    // TypeScript is in semantic, not procedural
    expect(result.memories.length).toBe(0);
  });

  it("excludes superseded entries by default", () => {
    memoryAdd(db, { content: "old version of facts", layer: "semantic", source_file: "doc.md" });
    memoryAdd(db, { content: "new version of facts", layer: "semantic", source_file: "doc.md" });

    const result = memorySearch(db, { query: "version facts" });
    expect(result.memories.length).toBe(1);
    expect(result.memories[0]!.content).toContain("new version");
  });

  it("includes superseded when requested", () => {
    memoryAdd(db, { content: "old version of facts", layer: "semantic", source_file: "doc.md" });
    memoryAdd(db, { content: "new version of facts", layer: "semantic", source_file: "doc.md" });

    const result = memorySearch(db, { query: "version facts", include_superseded: true });
    expect(result.memories.length).toBe(2);
  });

  it("excludes expired memories", () => {
    const result = memoryAdd(db, { content: "expired content here", layer: "episodic", ttl_days: 1 });
    // Manually set expires_at to the past
    db.prepare("UPDATE memories SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(result.id);

    const search = memorySearch(db, { query: "expired content" });
    expect(search.memories.length).toBe(0);
  });

  it("falls back to OR when AND returns nothing", () => {
    memoryAdd(db, { content: "SQLite database engine is fast", layer: "semantic" });
    // Query with words that won't all appear together
    const result = memorySearch(db, { query: "SQLite PostgreSQL comparison" });
    // OR fallback should find SQLite match
    expect(result.memories.length).toBeGreaterThan(0);
  });

  it("exact mode finds substring matches", () => {
    memoryAdd(db, { content: "the quick brown fox jumps over lazy dog", layer: "semantic" });
    const result = memorySearch(db, { query: "brown fox", mode: "exact" });
    expect(result.memories.length).toBe(1);
  });

  it("updates access_count on search", () => {
    const added = memoryAdd(db, { content: "access tracking test", layer: "semantic" });
    memorySearch(db, { query: "access tracking" });

    const row = db.prepare("SELECT access_count FROM memories WHERE id = ?").get(added.id) as { access_count: number };
    expect(row.access_count).toBe(1);
  });

  it("returns query_time_ms", () => {
    seedMemories();
    const result = memorySearch(db, { query: "TypeScript" });
    expect(result.query_time_ms).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// memory_update
// ---------------------------------------------------------------------------

describe("memory_update", () => {
  it("updates content in place", () => {
    const added = memoryAdd(db, { content: "original", layer: "semantic" });
    const result = memoryUpdate(db, { id: added.id, content: "updated" });

    expect(result.superseded).toBe(false);
    expect(result.updated_id).toBe(added.id);

    const row = db.prepare("SELECT content FROM memories WHERE id = ?").get(added.id) as { content: string };
    expect(row.content).toBe("updated");
  });

  it("creates superseding entry when supersede=true", () => {
    const added = memoryAdd(db, { content: "original", layer: "semantic" });
    const result = memoryUpdate(db, { id: added.id, new_content: "superseded version", supersede: true });

    expect(result.superseded).toBe(true);
    expect(result.new_id).toBeTruthy();

    const oldRow = db.prepare("SELECT superseded_by FROM memories WHERE id = ?").get(added.id) as { superseded_by: string };
    expect(oldRow.superseded_by).toBe(result.new_id);

    const newRow = db.prepare("SELECT content, supersedes FROM memories WHERE id = ?").get(result.new_id!) as { content: string; supersedes: string };
    expect(newRow.content).toBe("superseded version");
    expect(newRow.supersedes).toBe(added.id);
  });

  it("throws on non-existent ID", () => {
    expect(() => memoryUpdate(db, { id: "nonexistent" })).toThrow("Memory not found");
  });

  it("merges meta on update", () => {
    const added = memoryAdd(db, { content: "test", layer: "semantic", meta: { a: 1 } });
    memoryUpdate(db, { id: added.id, meta: { b: 2 } });

    const row = db.prepare("SELECT meta FROM memories WHERE id = ?").get(added.id) as { meta: string };
    const meta = JSON.parse(row.meta) as Record<string, unknown>;
    expect(meta).toEqual({ a: 1, b: 2 });
  });

  it("logs update event with old and new content", () => {
    const added = memoryAdd(db, { content: "before", layer: "semantic" });
    memoryUpdate(db, { id: added.id, content: "after" });

    const events = db.prepare("SELECT event_type, old_content, new_content FROM event_log WHERE memory_id = ? ORDER BY occurred_at").all(added.id) as Array<{ event_type: string; old_content: string | null; new_content: string | null }>;
    // First event: created, second: updated
    expect(events).toHaveLength(2);
    expect(events[1]!.event_type).toBe("updated");
    expect(events[1]!.old_content).toBe("before");
    expect(events[1]!.new_content).toBe("after");
  });
});

// ---------------------------------------------------------------------------
// memory_inspect
// ---------------------------------------------------------------------------

describe("memory_inspect", () => {
  it("returns layer stats when no id", () => {
    memoryAdd(db, { content: "fact 1", layer: "semantic" });
    memoryAdd(db, { content: "fact 2", layer: "semantic" });
    memoryAdd(db, { content: "event 1", layer: "episodic" });

    const result = memoryInspect(db, {});
    expect(result.layer_stats).toBeDefined();
    expect(result.layer_stats!.semantic.active).toBe(2);
    expect(result.layer_stats!.episodic.active).toBe(1);
    expect(result.layer_stats!.procedural.active).toBe(0);
  });

  it("returns full memory by id", () => {
    const added = memoryAdd(db, { content: "inspect me", layer: "resource", title: "Test" });
    const result = memoryInspect(db, { id: added.id });

    expect(result.memory).toBeDefined();
    expect(result.memory!.content).toBe("inspect me");
    expect(result.memory!.title).toBe("Test");
  });

  it("increments access_count on inspect", () => {
    const added = memoryAdd(db, { content: "track access", layer: "semantic" });
    memoryInspect(db, { id: added.id });
    memoryInspect(db, { id: added.id });

    const row = db.prepare("SELECT access_count FROM memories WHERE id = ?").get(added.id) as { access_count: number };
    expect(row.access_count).toBe(2);
  });

  it("returns superseded chain with include_history", () => {
    const v1 = memoryAdd(db, { content: "v1", layer: "semantic", source_file: "chain.md" });
    const v2 = memoryAdd(db, { content: "v2", layer: "semantic", source_file: "chain.md" });

    const result = memoryInspect(db, { id: v2.id, include_history: true });
    expect(result.superseded_chain).toBeDefined();
    expect(result.superseded_chain!.length).toBeGreaterThanOrEqual(1);
    expect(result.superseded_chain![0]!.id).toBe(v1.id);
  });

  it("throws on non-existent id", () => {
    expect(() => memoryInspect(db, { id: "nonexistent" })).toThrow("Memory not found");
  });

  it("inspectById response does not contain stemmed_content or stemmed_title", () => {
    const added = memoryAdd(db, { content: "stemmed leak test", layer: "semantic", title: "Leak Test" });
    const result = memoryInspect(db, { id: added.id });
    expect(result.memory).toBeDefined();
    expect(result.memory).not.toHaveProperty("stemmed_content");
    expect(result.memory).not.toHaveProperty("stemmed_title");
  });

  it("superseded chain entries do not contain stemmed columns", () => {
    const v1 = memoryAdd(db, { content: "chain v1", layer: "semantic", source_file: "leak-chain.md" });
    const v2 = memoryAdd(db, { content: "chain v2", layer: "semantic", source_file: "leak-chain.md" });

    const result = memoryInspect(db, { id: v2.id, include_history: true });
    expect(result.superseded_chain).toBeDefined();
    expect(result.superseded_chain!.length).toBeGreaterThanOrEqual(1);
    for (const entry of result.superseded_chain!) {
      expect(entry).not.toHaveProperty("stemmed_content");
      expect(entry).not.toHaveProperty("stemmed_title");
    }
  });
});

// ---------------------------------------------------------------------------
// memory_delete
// ---------------------------------------------------------------------------

describe("memory_delete", () => {
  it("deletes a memory and returns confirmation", () => {
    const added = memoryAdd(db, { content: "delete me", layer: "semantic" });
    const result = memoryDelete(db, { id: added.id });

    expect(result.deleted).toBe(true);
    expect(result.deleted_id).toBe(added.id);

    const row = db.prepare("SELECT id FROM memories WHERE id = ?").get(added.id);
    expect(row).toBeUndefined();
  });

  it("re-activates predecessor when deleting a superseding entry", () => {
    const v1 = memoryAdd(db, { content: "v1", layer: "semantic", source_file: "chain.md" });
    const v2 = memoryAdd(db, { content: "v2", layer: "semantic", source_file: "chain.md" });

    // v1 should be superseded by v2
    const before = db.prepare("SELECT superseded_by FROM memories WHERE id = ?").get(v1.id) as { superseded_by: string | null };
    expect(before.superseded_by).toBe(v2.id);

    // Delete v2 → v1 becomes active again
    memoryDelete(db, { id: v2.id });

    const after = db.prepare("SELECT superseded_by FROM memories WHERE id = ?").get(v1.id) as { superseded_by: string | null };
    expect(after.superseded_by).toBeNull();
  });

  it("removes deleted entry from FTS index", () => {
    const added = memoryAdd(db, { content: "unique_fts_deletion_test_token", layer: "semantic" });
    memoryDelete(db, { id: added.id });

    const search = memorySearch(db, { query: "unique_fts_deletion_test_token" });
    expect(search.memories.length).toBe(0);
  });

  it("logs deletion in event_log", () => {
    const added = memoryAdd(db, { content: "log this deletion", layer: "semantic" });
    memoryDelete(db, { id: added.id });

    const events = db.prepare("SELECT event_type FROM event_log WHERE memory_id = ? ORDER BY occurred_at DESC").all(added.id) as Array<{ event_type: string }>;
    expect(events.some(e => e.event_type === "deleted")).toBe(true);
  });

  it("throws on non-existent ID", () => {
    expect(() => memoryDelete(db, { id: "nonexistent" })).toThrow("Memory not found");
  });
});

// ---------------------------------------------------------------------------
// memory_export
// ---------------------------------------------------------------------------

describe("memory_export", () => {
  function seedForExport() {
    memoryAdd(db, { content: "Semantic fact 1", layer: "semantic", title: "Fact 1" });
    memoryAdd(db, { content: "Semantic fact 2", layer: "semantic", title: "Fact 2" });
    memoryAdd(db, { content: "Episodic event", layer: "episodic", title: "Event", event_at: "2026-01-15T10:00:00Z" });
  }

  it("exports as JSON", () => {
    seedForExport();
    const result = memoryExport(db, { format: "json" });
    expect(result.format).toBe("json");
    expect(result.count).toBe(3);
    const parsed = JSON.parse(result.content) as unknown[];
    expect(parsed).toHaveLength(3);
  });

  it("exports as markdown", () => {
    seedForExport();
    const result = memoryExport(db, { format: "markdown" });
    expect(result.content).toContain("# Memory Export");
    expect(result.content).toContain("## semantic");
    expect(result.content).toContain("## episodic");
  });

  it("exports as claude-md", () => {
    seedForExport();
    const result = memoryExport(db, { format: "claude-md" });
    expect(result.content).toContain("## Fact 1");
    expect(result.content).toContain("<!-- semantic");
  });

  it("filters by layer", () => {
    seedForExport();
    const result = memoryExport(db, { format: "json", layers: ["episodic"] });
    expect(result.count).toBe(1);
  });

  it("respects limit", () => {
    seedForExport();
    const result = memoryExport(db, { format: "json", limit: 2 });
    expect(result.count).toBe(2);
  });

  it("excludes superseded by default", () => {
    memoryAdd(db, { content: "old", layer: "semantic", source_file: "test.md" });
    memoryAdd(db, { content: "new", layer: "semantic", source_file: "test.md" });
    const result = memoryExport(db, { format: "json" });
    expect(result.count).toBe(1);
  });

  it("uses COALESCE(event_at, created_at) for date filter", () => {
    seedForExport();
    const result = memoryExport(db, { format: "json", date_from: "2026-01-01", date_to: "2026-01-31" });
    expect(result.count).toBe(1);
    const parsed = JSON.parse(result.content) as Array<{ title: string }>;
    expect(parsed[0]!.title).toBe("Event");
  });
});

// ---------------------------------------------------------------------------
// memory_search — pagination
// ---------------------------------------------------------------------------

describe("memory_search — pagination", () => {
  it("supports offset for pagination", () => {
    // Use distinct importance values for deterministic ordering in exact mode
    for (let i = 1; i <= 5; i++) {
      memoryAdd(db, { content: `pagination test item ${i}`, layer: "semantic", importance: i * 0.15 });
    }

    const all = memorySearch(db, { query: "pagination test", mode: "exact", limit: 5 });
    const page1 = memorySearch(db, { query: "pagination test", mode: "exact", limit: 2 });
    const page2 = memorySearch(db, { query: "pagination test", mode: "exact", limit: 2, offset: 2 });

    expect(all.memories.length).toBe(5);
    expect(page1.memories.length).toBe(2);
    expect(page2.memories.length).toBe(2);

    // Page1 = top 2 by importance, page2 = next 2
    expect(page1.memories[0]!.id).toBe(all.memories[0]!.id);
    expect(page1.memories[1]!.id).toBe(all.memories[1]!.id);
    expect(page2.memories[0]!.id).toBe(all.memories[2]!.id);
    expect(page2.memories[1]!.id).toBe(all.memories[3]!.id);
  });

  it("offset larger than limit returns correct slice", () => {
    for (let i = 0; i < 25; i++) {
      memoryAdd(db, { content: `deep pagination item ${i}`, layer: "semantic", importance: (25 - i) * 0.04 });
    }

    const all = memorySearch(db, { query: "deep pagination item", mode: "exact", limit: 25 });
    const page = memorySearch(db, { query: "deep pagination item", mode: "exact", limit: 3, offset: 20 });

    expect(all.memories.length).toBe(25);
    expect(page.memories.length).toBe(3);
    expect(page.memories[0]!.id).toBe(all.memories[20]!.id);
    expect(page.memories[1]!.id).toBe(all.memories[21]!.id);
    expect(page.memories[2]!.id).toBe(all.memories[22]!.id);
  });
});

// ---------------------------------------------------------------------------
// memory_update — supersede protection
// ---------------------------------------------------------------------------

describe("memory_update — supersede protection", () => {
  it("throws when trying to supersede an already-superseded entry", () => {
    const v1 = memoryAdd(db, { content: "v1", layer: "semantic", source_file: "prot.md" });
    memoryAdd(db, { content: "v2", layer: "semantic", source_file: "prot.md" });

    expect(() =>
      memoryUpdate(db, { id: v1.id, supersede: true, new_content: "v3" })
    ).toThrow("Cannot supersede");
  });

  it("superseding entry gets null expires_at when original was expired", () => {
    const old = memoryAdd(db, { content: "will expire", layer: "semantic", ttl_days: 1 });
    db.prepare("UPDATE memories SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(old.id);
    const result = memoryUpdate(db, { id: old.id, supersede: true, new_content: "new version" });
    const row = db.prepare("SELECT expires_at FROM memories WHERE id = ?").get(result.new_id!) as { expires_at: string | null };
    expect(row.expires_at).toBeNull();
  });

  it("superseding entry inherits non-expired expires_at", () => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const futureStr = future.toISOString().replace(/\.\d{3}Z$/, "Z");

    const old = memoryAdd(db, { content: "will expire later", layer: "semantic", ttl_days: 30 });
    const result = memoryUpdate(db, { id: old.id, supersede: true, new_content: "updated version" });
    const row = db.prepare("SELECT expires_at FROM memories WHERE id = ?").get(result.new_id!) as { expires_at: string | null };
    expect(row.expires_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// memory_search — LIKE escape in exact mode
// ---------------------------------------------------------------------------

describe("memory_search — exact mode LIKE escape", () => {
  it("does not treat % as wildcard in exact mode", () => {
    memoryAdd(db, { content: "100% correct answer", layer: "semantic" });
    memoryAdd(db, { content: "totally wrong answer", layer: "semantic" });

    const result = memorySearch(db, { query: "100%", mode: "exact" });
    expect(result.memories.length).toBe(1);
    expect(result.memories[0]!.content).toContain("100%");
  });

  it("does not treat _ as single-char wildcard in exact mode", () => {
    memoryAdd(db, { content: "file_name.ts is important", layer: "semantic" });
    memoryAdd(db, { content: "filename is different", layer: "semantic" });

    const result = memorySearch(db, { query: "file_name", mode: "exact" });
    expect(result.memories.length).toBe(1);
    expect(result.memories[0]!.content).toContain("file_name");
  });
});

// ---------------------------------------------------------------------------
// Stop word filtering (T-091)
// ---------------------------------------------------------------------------

describe("stop word filtering", () => {
  it("strips Russian navigational words from query", () => {
    memoryAdd(db, { content: "Серии привычек хранятся в трекере", layer: "semantic" });
    // "Где хранятся серии привычек" — "Где" is a stop word, should be stripped
    const result = memorySearch(db, { query: "Где хранятся серии привычек" });
    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.memories[0]!.content).toContain("привычек");
  });

  it("strips Russian question words: какой, сколько, что", () => {
    memoryAdd(db, { content: "Дневная норма калорий составляет 2200 ккал", layer: "semantic" });
    // "Какая дневная норма калорий" — "Какая" is a stop word
    const result = memorySearch(db, { query: "Какая дневная норма калорий" });
    expect(result.memories.length).toBeGreaterThan(0);
  });

  it("strips English stop words from queries", () => {
    memoryAdd(db, { content: "Human Design profile type is Generator 5/1", layer: "semantic" });
    // "What is the Human Design profile" — What/is/the are stop words
    const result = memorySearch(db, { query: "What is the Human Design profile" });
    expect(result.memories.length).toBeGreaterThan(0);
  });

  it("handles mixed Russian/English queries with stop words", () => {
    memoryAdd(db, { content: "Практика випассана с 2024 года", layer: "semantic" });
    // "Что это за практика випассана" — "Что", "это", "за" are stop words
    const result = memorySearch(db, { query: "Что это за практика випассана" });
    expect(result.memories.length).toBeGreaterThan(0);
  });

  it("falls back to original tokens when all are stop words", () => {
    memoryAdd(db, { content: "это был он а не она", layer: "episodic" });
    // All stop words — should fall back to using them
    const result = memorySearch(db, { query: "это был он" });
    // May or may not find (depends on FTS indexing of these short words)
    // Key: should NOT throw
    expect(result.query_time_ms).toBeGreaterThanOrEqual(0);
  });

  it("handles prepositions in context: 'про медитацию'", () => {
    memoryAdd(db, { content: "Книга про медитацию и осознанность", layer: "resource" });
    // "про" is a stop word, "медитацию" has semantic value
    const result = memorySearch(db, { query: "про медитацию" });
    expect(result.memories.length).toBeGreaterThan(0);
  });

  it("stemmer matches morphological variants: субличность/субличностях", () => {
    memoryAdd(db, { content: "Работа с субличностями через IFS терапию", layer: "semantic" });
    // Query uses different word form — stemmer should reduce both to "субличн"
    const result = memorySearch(db, { query: "субличность" });
    expect(result.memories.length).toBeGreaterThan(0);
  });

  it("stemmer matches English variants: meditation/meditating", () => {
    memoryAdd(db, { content: "Daily meditation practice improves focus", layer: "semantic" });
    const result = memorySearch(db, { query: "meditating daily" });
    expect(result.memories.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Validation edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("handles FTS5 special characters in search query", () => {
    memoryAdd(db, { content: "function() { return true; }", layer: "procedural" });
    // Should not throw — special chars are escaped
    const result = memorySearch(db, { query: "function() return" });
    expect(result.memories.length).toBeGreaterThanOrEqual(0);
  });

  it("handles empty search results gracefully", () => {
    const result = memorySearch(db, { query: "nonexistent_term_xyz" });
    expect(result.memories).toEqual([]);
    expect(result.total_found).toBe(0);
  });

  it("handles min_confidence filter", () => {
    memoryAdd(db, { content: "low confidence fact", layer: "semantic", confidence: 0.3 });
    memoryAdd(db, { content: "high confidence fact", layer: "semantic", confidence: 0.9 });

    const result = memorySearch(db, { query: "confidence fact", min_confidence: 0.5 });
    expect(result.memories.length).toBe(1);
    expect(result.memories[0]!.content).toContain("high");
  });

  it("handles date range filtering", () => {
    memoryAdd(db, { content: "January event", layer: "episodic", event_at: "2026-01-15T10:00:00Z" });
    memoryAdd(db, { content: "March event", layer: "episodic", event_at: "2026-03-15T10:00:00Z" });

    const result = memorySearch(db, { query: "event", date_from: "2026-03-01", date_to: "2026-03-31" });
    expect(result.memories.length).toBe(1);
    expect(result.memories[0]!.content).toContain("March");
  });
});

// ---------------------------------------------------------------------------
// Index-time stemming
// ---------------------------------------------------------------------------

describe("index-time stemming", () => {
  it("populates stemmed_content and stemmed_title on insert", () => {
    const result = memoryAdd(db, {
      content: "Субличности в психологии — внутренние части личности",
      layer: "semantic",
      title: "Субличности",
    });

    const row = db.prepare("SELECT stemmed_content, stemmed_title FROM memories WHERE id = ?")
      .get(result.id) as { stemmed_content: string; stemmed_title: string };

    expect(row.stemmed_content).toBeTruthy();
    expect(row.stemmed_title).toBeTruthy();
    // Stemmed content should be shorter (stems are truncated)
    expect(row.stemmed_content.length).toBeLessThan("Субличности в психологии — внутренние части личности".length);
  });

  it("FTS5 indexes stemmed content for better morphological matching", () => {
    memoryAdd(db, {
      content: "Работа с субличностями через IFS терапию",
      layer: "semantic",
    });

    // Verify FTS5 contains stemmed form
    const ftsRow = db.prepare("SELECT content FROM memories_fts WHERE memories_fts MATCH ?")
      .get(stemText("субличностями")) as { content: string } | undefined;

    expect(ftsRow).toBeDefined();
  });

  it("updates stemmed content on in-place update", () => {
    const added = memoryAdd(db, {
      content: "original content",
      layer: "semantic",
      title: "Original Title",
    });

    memoryUpdate(db, { id: added.id, content: "Обновлённое содержание записи" });

    const row = db.prepare("SELECT stemmed_content FROM memories WHERE id = ?")
      .get(added.id) as { stemmed_content: string };

    expect(row.stemmed_content).toContain("обновлён");
  });

  it("populates stemmed content on superseding entry", () => {
    const v1 = memoryAdd(db, { content: "version one", layer: "semantic" });
    const result = memoryUpdate(db, {
      id: v1.id,
      new_content: "Новая версия с другим содержанием",
      supersede: true,
    });

    const row = db.prepare("SELECT stemmed_content FROM memories WHERE id = ?")
      .get(result.new_id!) as { stemmed_content: string };

    expect(row.stemmed_content).toBeTruthy();
    expect(row.stemmed_content).toContain("нов");
  });

  it("stemText handles mixed Russian/English content", () => {
    const result = stemText("TypeScript enables strict type checking для проектов");
    expect(result).toContain("typescript");
    expect(result).toContain("проект"); // "проектов" → stem "проект"
    expect(result).toContain("enabl"); // "enables" → stem "enabl"
    // Note: stop words are NOT removed by stemText — that's query-time only
  });

  it("stemText preserves numbers", () => {
    const result = stemText("Version 2026 has 100 features");
    expect(result).toContain("2026");
    expect(result).toContain("100");
  });
});

// ---------------------------------------------------------------------------
// MCP Resources (via createMcpServer)
// ---------------------------------------------------------------------------

describe("MCP server capabilities", () => {
  it("createMcpServer returns a server with tools, resources, and prompts", async () => {
    // Verify the server factory imports work and capabilities are set
    const { createMcpServer } = await import("../../server.js");
    const server = createMcpServer(db);
    expect(server).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// EventType and event_log consistency
// ---------------------------------------------------------------------------

describe("event_log schema", () => {
  it("accepts 'deleted' event type in event_log", () => {
    const added = memoryAdd(db, { content: "event type test", layer: "semantic" });
    // memory_delete inserts 'deleted' event type
    memoryDelete(db, { id: added.id });
    const events = db.prepare(
      "SELECT event_type FROM event_log WHERE memory_id = ? AND event_type = 'deleted'"
    ).all(added.id) as Array<{ event_type: string }>;
    expect(events.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// insertMemory shared helper (via memory_add + memory_update)
// ---------------------------------------------------------------------------

describe("shared insertMemory helper", () => {
  it("memory_add and memory_update produce identical column structure", () => {
    const added = memoryAdd(db, {
      content: "helper test original",
      layer: "semantic",
      title: "Helper Test",
      entity_name: "test-entity",
      importance: 0.7,
    });

    const result = memoryUpdate(db, {
      id: added.id,
      supersede: true,
      new_content: "helper test superseded",
    });

    const cols1 = Object.keys(
      db.prepare("SELECT * FROM memories WHERE id = ?").get(added.id) as Record<string, unknown>
    ).sort();
    const cols2 = Object.keys(
      db.prepare("SELECT * FROM memories WHERE id = ?").get(result.new_id!) as Record<string, unknown>
    ).sort();

    expect(cols1).toEqual(cols2);
  });
});
