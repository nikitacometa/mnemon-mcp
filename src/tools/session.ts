/**
 * Session lifecycle tools — start, end, and list agent sessions.
 *
 * Sessions group episodic memories together. A session tracks
 * which client (e.g. claude-code, cursor) was active, when it started/ended,
 * and an optional summary of what was accomplished.
 */

import type Database from "better-sqlite3";
import type {
  SessionStartInput,
  SessionStartOutput,
  SessionEndInput,
  SessionEndOutput,
  SessionListInput,
  SessionListOutput,
} from "../types.js";

interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
}

interface CountRow {
  count: number;
}

interface SessionWithCount {
  id: string;
  client: string;
  project: string | null;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  memories_count: number;
}

export function sessionStart(
  db: Database.Database,
  input: SessionStartInput
): SessionStartOutput {
  const metaJson = input.meta ? JSON.stringify(input.meta) : "{}";

  const row = db.prepare<[string, string | null, string], SessionRow>(
    `INSERT INTO sessions (client, project, meta)
     VALUES (?, ?, ?)
     RETURNING id, started_at`
  ).get(input.client, input.project ?? null, metaJson)!;

  return {
    id: row.id,
    started_at: row.started_at,
  };
}

export function sessionEnd(
  db: Database.Database,
  input: SessionEndInput
): SessionEndOutput {
  const session = db.prepare<[string], SessionRow>(
    `SELECT id, started_at, ended_at FROM sessions WHERE id = ?`
  ).get(input.id);

  if (!session) {
    throw new Error(`Session not found: ${input.id}`);
  }

  if (session.ended_at) {
    throw new Error(`Session already ended at ${session.ended_at}`);
  }

  const result = db.prepare<[string | null, string], { ended_at: string }>(
    `UPDATE sessions
     SET ended_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
         summary = COALESCE(?, summary)
     WHERE id = ?
     RETURNING ended_at`
  ).get(input.summary ?? null, input.id)!;

  const memoriesCount = db.prepare<[string], CountRow>(
    `SELECT COUNT(*) AS count FROM memories WHERE session_id = ?`
  ).get(input.id)!.count;

  const startMs = new Date(session.started_at).getTime();
  const endMs = new Date(result.ended_at).getTime();
  const durationMinutes = Math.round((endMs - startMs) / 60_000);

  return {
    id: input.id,
    ended_at: result.ended_at,
    duration_minutes: durationMinutes,
    memories_count: memoriesCount,
  };
}

export function sessionList(
  db: Database.Database,
  input: SessionListInput
): SessionListOutput {
  const limit = input.limit ?? 20;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (input.client) {
    conditions.push("s.client = ?");
    params.push(input.client);
  }

  if (input.project) {
    conditions.push("s.project = ?");
    params.push(input.project);
  }

  if (input.active_only) {
    conditions.push("s.ended_at IS NULL");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit);

  const rows = db.prepare<(string | number)[], SessionWithCount>(
    `SELECT s.id, s.client, s.project, s.started_at, s.ended_at, s.summary,
            (SELECT COUNT(*) FROM memories m WHERE m.session_id = s.id) AS memories_count
     FROM sessions s
     ${where}
     ORDER BY s.started_at DESC
     LIMIT ?`
  ).all(...params);

  return {
    sessions: rows.map((r) => ({
      id: r.id,
      client: r.client,
      project: r.project,
      started_at: r.started_at,
      ended_at: r.ended_at,
      summary: r.summary,
      memories_count: r.memories_count,
    })),
    returned_count: rows.length,
  };
}
