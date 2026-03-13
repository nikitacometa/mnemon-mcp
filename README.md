# mnemon-mcp

[![CI](https://github.com/nikitacometa/mnemon-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/nikitacometa/mnemon-mcp/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

Persistent layered memory for AI agents. SQLite + FTS5 backend, zero-cloud, zero-embedding.

Built on the [Model Context Protocol](https://modelcontextprotocol.io) — works with Claude Code, Cursor, Windsurf, and any MCP-compatible client.

## Why mnemon-mcp?

Most AI memory systems require cloud APIs, vector databases, or embedding models. mnemon-mcp takes a different approach:

- **Zero dependencies on external services** — everything runs locally in SQLite
- **4-layer cognitive model** — episodic, semantic, procedural, resource — instead of a flat key-value store
- **Fact versioning** — superseding chains track how knowledge evolves over time
- **Full-text search with BM25 ranking** — FTS5 with Snowball stemming for English and Russian
- **Two transports** — stdio for local agents, HTTP for remote/multi-server setups

## Requirements

- **Node.js >= 22.0.0** (uses `node:fs` globSync, stable ESM)
- npm 9+

## Quick Start

### 1. Install

```bash
git clone https://github.com/nikitacometa/mnemon-mcp.git
cd mnemon-mcp
npm install
npm run build
```

### 2. Configure your MCP client

**Claude Code** (`~/.claude/mcp.json`):

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

**Cursor / Windsurf** — add the same server config to your MCP settings file.

### 3. Verify

```bash
# Smoke test — should return a list of 6 tools
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/index.js
```

### 4. Use it

The server creates `~/.mnemon-mcp/memory.db` automatically on first run.

```
You: Remember that I prefer TypeScript over JavaScript for new projects
Agent: [calls memory_add with layer="semantic", content="User prefers TypeScript..."]

You: What do I prefer for new projects?
Agent: [calls memory_search with query="preferences new projects"]
→ Returns: "User prefers TypeScript over JavaScript for new projects"
```

## Tools

| Tool | Description |
|------|-------------|
| `memory_add` | Store a memory with layer, entity, confidence, importance, TTL |
| `memory_search` | FTS5 search with layer/entity/date/scope/confidence filters |
| `memory_update` | Update in-place or create a versioned replacement (superseding chain) |
| `memory_delete` | Permanently remove a memory, re-activating its predecessor if any |
| `memory_inspect` | Layer statistics or single memory with full history trace |
| `memory_export` | Export to JSON, Markdown, or claude-md (compact LLM format) |

## 4-Layer Memory Model

| Layer | What it stores | Access pattern | Example |
|-------|---------------|----------------|---------|
| **episodic** | Events, sessions, conversations | By date/period | "Debugged auth issue on March 5" |
| **semantic** | Facts, preferences, relationships | By topic/entity | "User prefers dark theme" |
| **procedural** | Rules, workflows, conventions | Loaded at startup | "Always run tests before commit" |
| **resource** | Reference material, summaries | On demand | "Book notes: Designing Data-Intensive Apps" |

## Superseding Chains

When facts change, mnemon-mcp doesn't delete the old version — it creates a **superseding chain**:

```
v1: "Team uses React 17"  →  superseded_by: v2
v2: "Team uses React 19"  →  supersedes: v1 (active)
```

Search automatically returns only the latest version. Use `memory_inspect` with `include_history: true` to see the full chain.

## Importing a Knowledge Base

mnemon-mcp can bulk-import a directory of Markdown files into the memory database.

### 1. Create a config file

Copy the example and customize for your KB structure:

```bash
mkdir -p ~/.mnemon-mcp
cp config.example.json ~/.mnemon-mcp/config.json
```

Edit `~/.mnemon-mcp/config.json` to map your directories to memory layers:

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
      "confidence": 0.9,
      "split": "h2"
    },
    {
      "glob": "notes/**/*.md",
      "layer": "semantic",
      "entity_type": "concept",
      "entity_name": "from-heading",
      "importance": 0.5,
      "confidence": 0.8,
      "split": "h2"
    }
  ]
}
```

### 2. Run the import

```bash
# Incremental import (skips unchanged files)
npm run import:kb -- --kb-path /path/to/your/kb

# Full re-import (overwrites all)
npx tsx src/import/cli.ts --kb-path /path/to/your/kb --force
```

### Config reference

| Field | Values | Description |
|-------|--------|-------------|
| `glob` | `"journal/**/*.md"` | File pattern relative to KB root |
| `layer` | `episodic`, `semantic`, `procedural`, `resource` | Target memory layer |
| `entity_type` | `user`, `project`, `person`, `concept`, `file`, `rule`, `tool` | Entity classification |
| `entity_name` | string, `"from-heading"`, `"$owner"` | Entity name (or derive from H1, or use owner_name) |
| `split` | `whole`, `h2`, `h3` | How to split files into memory records |
| `importance` | `0.0–1.0` | Retrieval priority weight |
| `confidence` | `0.0–1.0` | How certain this memory is |
| `file_pattern` | regex string | Optional filename filter |
| `scope` | string | Project/context scope (default: `"global"`) |

## HTTP Transport

For remote access or multi-server deployments:

```bash
# Start HTTP server
MNEMON_PORT=3000 npm run start:http

# With authentication (recommended for production)
MNEMON_AUTH_TOKEN=your-secret-token MNEMON_PORT=3000 npm run start:http
```

**Endpoints:**
- `POST /mcp` — MCP JSON-RPC endpoint
- `GET /health` — Health check (returns `{"status":"ok","version":"1.0.0"}`)

Configure in your MCP client as a remote server:

```json
{
  "mcpServers": {
    "mnemon-mcp": {
      "url": "http://your-server:3000/mcp",
      "headers": {
        "Authorization": "Bearer your-secret-token"
      }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MNEMON_DB_PATH` | `~/.mnemon-mcp/memory.db` | SQLite database file path |
| `MNEMON_KB_PATH` | `.` (cwd) | Default knowledge base path for `npm run import:kb` |
| `MNEMON_AUTH_TOKEN` | *(none)* | Bearer token for HTTP transport authentication |
| `MNEMON_PORT` | `3000` | HTTP transport listening port |

## Database

- **Path:** `~/.mnemon-mcp/memory.db` (override with `MNEMON_DB_PATH`)
- **Engine:** SQLite with WAL mode, FTS5 full-text search
- **Stemming:** Snowball stemmer for English and Russian morphology
- **Tokenizer:** unicode61 (Cyrillic + Latin support)
- **Migrations:** Automatic via `PRAGMA user_version`
- **Backup:** `npm run db:backup` creates `~/.mnemon-mcp/memory.db.bak`

## Development

```bash
npm run dev        # Run via tsx (no build needed)
npm run build      # Compile TypeScript → dist/
npm test           # Run 66 tests (vitest)
npm run bench      # Performance benchmarks (vitest bench)
npm start          # Run compiled stdio server
npm run start:http # Run compiled HTTP server
```

## Troubleshooting

**Server doesn't appear in Claude Code / Cursor:**
- Verify the path in `mcp.json` is absolute and points to `dist/index.js`
- Run `npm run build` — the `dist/` directory is not included in git
- Check `~/.claude/mcp.json` for JSON syntax errors

**Import fails with "config not found":**
- Run `mkdir -p ~/.mnemon-mcp && cp config.example.json ~/.mnemon-mcp/config.json`
- Edit config.json to match your KB directory structure

**"Cannot find module" or "ERR_MODULE_NOT_FOUND":**
- Ensure Node.js >= 22.0.0 (`node --version`)
- Run `npm run build` to regenerate `dist/`

**Empty search results:**
- Verify data exists: `echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"memory_inspect","arguments":{}},"id":1}' | node dist/index.js`
- Check if memories are superseded (use `include_superseded: true` in search)
- For morphological mismatches, try shorter query terms

**HTTP server binds to wrong port:**
- Set `MNEMON_PORT` explicitly: `MNEMON_PORT=3000 npm run start:http`
- Check for port conflicts: `lsof -i :3000`

## Tech Stack

| Component | Version | Why |
|-----------|---------|-----|
| TypeScript | 5.9 | Strict mode, NodeNext modules |
| better-sqlite3 | 12.x | Synchronous SQLite — ideal for MCP stdio |
| @modelcontextprotocol/sdk | 1.27 | Official MCP server framework |
| Snowball stemmer | 0.2 | Morphological stemming (EN + RU) |
| zod | 4.x | Runtime input validation |
| vitest | 3.x | Test runner + benchmarks |

## Philosophy

- **Air-gapped by design** — no network calls, no telemetry, no cloud. Your memories stay on your machine.
- **SQLite over Postgres** — single-file database, zero ops, instant setup.
- **FTS5 over embeddings** — deterministic, interpretable search. No GPU, no API keys, no vector DB.
- **Layered over flat** — different types of knowledge have different access patterns and lifetimes.

## License

MIT
