/**
 * memory_health — diagnostic report on memory store quality.
 *
 * Returns health metrics: expired entries, orphaned chains, stale memories,
 * low-confidence entries, and storage stats per layer.
 * Optional cleanup=true garbage-collects expired entries.
 */

import type Database from "better-sqlite3";
import type { MemoryHealthInput, MemoryHealthOutput } from "../types.js";

interface CountRow {
  count: number;
}

interface LayerCountRow {
  layer: string;
  count: number;
}

interface OrphanRow {
  id: string;
  supersedes: string;
}

interface ExpiredRow {
  id: string;
  title: string | null;
  expires_at: string;
}

export function memoryHealth(
  db: Database.Database,
  input: MemoryHealthInput
): MemoryHealthOutput {
  const now = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";

  // Total active memories per layer
  const activeByLayer = db
    .prepare<[], LayerCountRow>(
      `SELECT layer, COUNT(*) AS count FROM memories
       WHERE superseded_by IS NULL
       GROUP BY layer`
    )
    .all();

  const totalActive = activeByLayer.reduce((sum, r) => sum + r.count, 0);
  const totalSuperseded = db
    .prepare<[], CountRow>(
      `SELECT COUNT(*) AS count FROM memories WHERE superseded_by IS NOT NULL`
    )
    .get()!.count;

  // Expired entries (TTL past due, not yet cleaned up)
  const expired = db
    .prepare<[], ExpiredRow>(
      `SELECT id, title, expires_at FROM memories
       WHERE expires_at IS NOT NULL AND expires_at < ${now}
         AND superseded_by IS NULL
       ORDER BY expires_at ASC
       LIMIT 50`
    )
    .all();

  // Orphaned chains: supersedes points to a non-existent memory
  const orphaned = db
    .prepare<[], OrphanRow>(
      `SELECT m.id, m.supersedes FROM memories m
       WHERE m.supersedes IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM memories m2 WHERE m2.id = m.supersedes)
       LIMIT 50`
    )
    .all();

  // Stale memories: active, not accessed in 30+ days (or never accessed)
  const staleCount = db
    .prepare<[], CountRow>(
      `SELECT COUNT(*) AS count FROM memories
       WHERE superseded_by IS NULL
         AND (last_accessed IS NULL OR julianday('now') - julianday(last_accessed) > 30)
         AND julianday('now') - julianday(created_at) > 7`
    )
    .get()!.count;

  // Low-confidence entries (below 0.3)
  const lowConfidenceCount = db
    .prepare<[], CountRow>(
      `SELECT COUNT(*) AS count FROM memories
       WHERE superseded_by IS NULL AND confidence < 0.3`
    )
    .get()!.count;

  // Optional: clean up expired entries
  let cleaned = 0;
  if (input.cleanup) {
    const result = db.prepare(
      `DELETE FROM memories
       WHERE expires_at IS NOT NULL AND expires_at < ${now}`
    ).run();
    cleaned = result.changes;
  }

  const issues: string[] = [];
  if (expired.length > 0) issues.push(`${expired.length} expired entries need cleanup`);
  if (orphaned.length > 0) issues.push(`${orphaned.length} orphaned chain references`);
  if (staleCount > 0) issues.push(`${staleCount} stale memories (not accessed in 30+ days)`);
  if (lowConfidenceCount > 0) issues.push(`${lowConfidenceCount} low-confidence entries (<0.3)`);

  const status = issues.length === 0 ? "healthy" : issues.length <= 2 ? "warning" : "degraded";

  return {
    status,
    issues,
    stats: {
      total_active: totalActive,
      total_superseded: totalSuperseded,
      by_layer: Object.fromEntries(activeByLayer.map((r) => [r.layer, r.count])),
    },
    expired: expired.map((r) => ({ id: r.id, title: r.title, expires_at: r.expires_at })),
    orphaned_chains: orphaned.map((r) => ({ id: r.id, missing_supersedes: r.supersedes })),
    stale_count: staleCount,
    low_confidence_count: lowConfidenceCount,
    ...(input.cleanup ? { cleaned_expired: cleaned } : {}),
  };
}
