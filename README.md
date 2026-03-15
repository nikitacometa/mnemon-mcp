# mnemon-mcp

[![CI](https://github.com/nikitacometa/mnemon-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/nikitacometa/mnemon-mcp/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

Persistent layered memory for AI agents — local-first, zero-cloud, single-file SQLite.

Works with any [MCP](https://modelcontextprotocol.io)-compatible client: Claude Code, Cursor, Windsurf, and others.

## Features

- **4-layer memory model** — episodic, semantic, procedural, resource — each with distinct access patterns and lifetimes
- **Full-text search** — FTS5 with BM25 ranking, field boosting, AND→OR fallback
- **Index-time stemming** — Snowball stemmer for English and Russian, applied at both index and query time for precise morphological matching
- **Fact versioning** — superseding chains track how knowledge evolves; search returns only the latest version
- **Knowledge base import** — bulk-import Markdown files with configurable layer routing, splitting, and deduplication
- **MCP Resources & Prompts** — 2 static resources (stats, recent), 2 resource templates (layer, entity); pre-built prompts for recall, context loading, journaling
- **Two transports** — stdio for local agents, HTTP with Bearer auth for remote setups
- **Zero external dependencies** — no vector DB, no embedding model, no cloud API. One SQLite file

## Quick Start

**Option A — npm (recommended):**

```bash
npm install -g mnemon-mcp
```

**Option B — from source:**

```bash
git clone https://github.com/nikitacometa/mnemon-mcp.git
cd mnemon-mcp && npm install && npm run build
```

Add to your MCP client config (e.g. `~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "mnemon-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/mnemon-mcp/dist/index.js"]
    }
  }
}
```

The database (`~/.mnemon-mcp/memory.db`) is created automatically on first run.

Verify: `echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/index.js`

## Tools

| Tool | Description |
|------|-------------|
| `memory_add` | Store a memory with layer, entity, confidence, importance, and optional TTL |
| `memory_search` | FTS5 or exact search with layer/entity/date/scope/confidence filters and pagination |
| `memory_update` | Update in-place or create a versioned replacement (superseding chain) |
| `memory_delete` | Permanently delete a memory, re-activating its predecessor if any |
| `memory_inspect` | Layer statistics or single-memory history trace |
| `memory_export` | Export to JSON, Markdown, or claude-md with filters |

### memory_add

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | Yes | Memory text (max 100K chars) |
| `layer` | string | Yes | `episodic` / `semantic` / `procedural` / `resource` |
| `title` | string | No | Short title (max 500 chars) |
| `entity_type` | string | No | `user` / `project` / `person` / `concept` / `file` / `rule` / `tool` |
| `entity_name` | string | No | Entity name for filtering |
| `confidence` | number | No | 0.0–1.0 (default 0.8) |
| `importance` | number | No | 0.0–1.0 (default 0.5) |
| `scope` | string | No | Namespace (default `global`) |
| `source_file` | string | No | Source file path — triggers auto-supersede of matching entries |
| `ttl_days` | number | No | Auto-expire after N days |
| `valid_from` / `valid_until` | string | No | Temporal fact window (ISO 8601) |

### memory_search

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search text (tokenized for FTS5) |
| `mode` | string | No | `fts` (default) or `exact` (LIKE substring) |
| `layers` | string[] | No | Filter by layers |
| `entity_name` | string | No | Filter by entity (supports aliases) |
| `scope` | string | No | Filter by scope |
| `date_from` / `date_to` | string | No | Date range filter (ISO 8601) |
| `as_of` | string | No | Temporal fact filter — only facts valid at this date |
| `min_confidence` | number | No | Minimum confidence threshold |
| `min_importance` | number | No | Minimum importance threshold |
| `limit` | number | No | Max results (default 10, max 100) |
| `offset` | number | No | Pagination offset |

### memory_update

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Memory ID to update |
| `content` | string | No | New content |
| `title` | string | No | New title |
| `confidence` | number | No | New confidence |
| `importance` | number | No | New importance |
| `supersede` | boolean | No | `true` = create versioned replacement; `false` (default) = in-place update |
| `new_content` | string | No | Content for superseding entry (when `supersede=true`) |

### memory_delete

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Memory ID to delete. Re-activates predecessor if any |

### memory_inspect

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | No | Specific memory ID. Without it — returns layer stats |
| `layer` | string | No | Filter stats by layer |
| `entity_name` | string | No | Filter stats by entity |
| `include_history` | boolean | No | Include superseding chain |

### memory_export

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | Yes | `json` / `markdown` / `claude-md` |
| `layers` | string[] | No | Filter by layers |
| `scope` | string | No | Filter by scope |
| `date_from` / `date_to` | string | No | Date range |
| `limit` | number | No | Max entries (default all, max 10K) |

## Memory Model

| Layer | Purpose | Access Pattern | Example |
|-------|---------|----------------|---------|
| **episodic** | Events, sessions | By date/period | "Debugged auth issue on March 5" |
| **semantic** | Facts, preferences | By topic/entity | "User prefers dark theme" |
| **procedural** | Rules, workflows | Loaded at startup | "Always run tests before commit" |
| **resource** | Reference material | On demand | "Book notes: Designing Data-Intensive Apps" |

Different kinds of knowledge have different lifetimes and retrieval patterns. A journal entry from last Tuesday and a coding convention that never changes shouldn't live in the same flat store.

## Search

Two modes, both with layer/entity/scope/date/confidence filters:

**FTS mode** (default) — tokenized full-text search with BM25 ranking. Multi-word queries use AND; if too few results, OR supplements automatically. Scores are boosted by importance and recency: `bm25 × (0.3 + 0.7 × importance) × decay(layer)`. Episodic memories decay with a 30-day half-life, resource with 90 days; semantic and procedural don't decay.

**Exact mode** — `LIKE` substring match for precise lookups. Useful when you need an exact phrase rather than tokenized matching.

## Fact Versioning

When a fact changes, mnemon-mcp doesn't delete the old version — it creates a superseding chain:

```
v1: "Team uses React 17"  →  superseded_by: v2
v2: "Team uses React 19"  →  supersedes: v1 (active)
```

Search returns only the latest. `memory_inspect` with `include_history: true` shows the full chain. `memory_delete` re-activates the predecessor.

## Importing a Knowledge Base

Bulk-import a directory of Markdown files with configurable routing:

```bash
cp config.example.json ~/.mnemon-mcp/config.json   # customize first
npm run import:kb -- --kb-path /path/to/your/kb     # incremental (skips unchanged)
npx tsx src/import/cli.ts --kb-path /path --force   # full re-import
```

Config maps glob patterns to memory layers:

```json
{
  "owner_name": "your-name",
  "extra_stop_words": ["your-name"],
  "mappings": [
    {
      "glob": "journal/**/*.md",
      "layer": "episodic",
      "entity_type": "user",
      "entity_name": "$owner",
      "importance": 0.6,
      "split": "h2"
    }
  ]
}
```

Each mapping specifies: `glob`, `layer`, `entity_type`, `entity_name` (string | `"from-heading"` | `"$owner"`), `split` (`whole` | `h2` | `h3`), `importance`, `confidence`, and optional `scope` and `file_pattern`.

## HTTP Transport

```bash
MNEMON_AUTH_TOKEN=secret MNEMON_PORT=3000 npm run start:http
```

- `POST /mcp` — MCP JSON-RPC endpoint (Bearer auth if token is set)
- `GET /health` — returns `{"status":"ok","version":"..."}`

Body size limit: 1MB. Timing-safe token comparison. Graceful shutdown on SIGTERM.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MNEMON_DB_PATH` | `~/.mnemon-mcp/memory.db` | SQLite database path |
| `MNEMON_KB_PATH` | `.` | Knowledge base path for import |
| `MNEMON_AUTH_TOKEN` | — | Bearer token for HTTP transport |
| `MNEMON_PORT` | `3000` | HTTP transport port |
| `MNEMON_CONFIG_PATH` | `~/.mnemon-mcp/config.json` | Import config file path |

## Development

```bash
npm run dev        # run via tsx (no build step)
npm run build      # TypeScript → dist/
npm test           # vitest
npm run bench      # performance benchmarks
npm run db:backup  # backup database
```

**Stack:** TypeScript 5.9 (strict), better-sqlite3 12.x, @modelcontextprotocol/sdk 1.27, Snowball stemmer, zod 4.x, vitest 3.x.

**Architecture:** `src/server.ts` (shared MCP factory) → `src/index.ts` (stdio) / `src/index-http.ts` (HTTP). Tools in `src/tools/`, import pipeline in `src/import/`. Database with WAL mode, FTS5 triggers with index-time Snowball stemming, versioned migrations via `PRAGMA user_version`.

## How It Compares

| | mnemon-mcp | mem0 | basic-memory | Anthropic KG |
|---|---|---|---|---|
| **Architecture** | SQLite FTS5 | Cloud API + Qdrant | Markdown + vector | JSON file |
| **Dependencies** | None | Qdrant, Neo4j, Ollama | FastEmbed, Python 3.12 | None |
| **Memory structure** | 4 layers | Flat | Flat | Graph |
| **Fact versioning** | Superseding chains | Partial | No | No |
| **Multilingual** | EN + RU stemming | EN only | EN only | None |
| **License** | MIT | Apache 2.0 | AGPL | MIT |
| **Cost** | Free | $19–249/mo | Free + SaaS | Free |
| **Setup** | `npm install` | Docker + cloud keys | pip + dependencies | Built-in |

## Design Principles

- **Air-gapped** — no network calls, no telemetry. Your memories stay on your machine.
- **Single file** — one SQLite database, zero ops, instant setup.
- **Deterministic search** — FTS5 over embeddings: interpretable, reproducible, no GPU required.
- **Structured over flat** — layers encode access patterns; superseding chains encode time.

## License

MIT
