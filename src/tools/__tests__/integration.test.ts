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
