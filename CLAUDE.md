---
last_updated: 2026-03-05
description: persona-mcp — persistent layered memory MCP server for AI agents
---

# persona-mcp

MCP server providing persistent layered memory for AI agents.
SQLite + FTS5 backend, zero-cloud, stdio transport.

## Commands

```bash
npm run build      # compile TypeScript → dist/
npm run dev        # run via tsx (no build step, for development)
npm start          # run compiled dist/index.js
```

## Architecture

```
src/
  index.ts          MCP server entry point (stdio transport, tool dispatch)
  db.ts             SQLite setup: schema creation, indexes, FTS5 triggers
  types.ts          Shared TypeScript types (mirrors SQLite schema)
  tools/
    memory-add.ts       Insert memory, supersede on source_file match
    memory-search.ts    FTS5 search with layer/scope/date filtering
    memory-update.ts    In-place update or superseding chain creation
    memory-inspect.ts   Layer stats or single-memory history trace
    memory-export.ts    [STUB] Export to json/markdown/claude-md
    style-extract.ts    [STUB] Writing style analysis
```

## Database

- Path: `~/.persona-mcp/memory.db`
- WAL mode, foreign keys ON, busy_timeout 5000ms
- FTS5 table `memories_fts` synced via INSERT/UPDATE/DELETE triggers
- Partial indexes exclude superseded entries from retrieval queries

## 4-Layer Memory Model

| Layer | Purpose | Default TTL |
|-------|---------|-------------|
| episodic | Events, sessions, journal | 7–90 days |
| semantic | Facts, concepts, people | None |
| procedural | Rules, workflows, CLAUDE.md | None |
| resource | Reference docs, book notes | None |

## Superseding Chain

When `memory_update` is called with `supersede=true`:
1. New entry is created with `supersedes = old.id`
2. Old entry's `superseded_by` is set to new entry's id
3. Partial indexes exclude old entry from search results
4. History is preserved — follow `supersedes` links via `memory_inspect`

## MCP Config (for Claude Code)

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "persona-mcp": {
      "command": "node",
      "args": ["/Users/<you>/dev/persona-mcp/dist/index.js"]
    }
  }
}
```

Or for development (no build required):

```json
{
  "mcpServers": {
    "persona-mcp": {
      "command": "npx",
      "args": ["tsx", "/Users/<you>/dev/persona-mcp/src/index.ts"]
    }
  }
}
```
