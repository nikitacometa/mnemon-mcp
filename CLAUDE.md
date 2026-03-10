---
last_updated: 2026-03-10
description: mnemon-mcp — persistent layered memory MCP server for AI agents
---

# mnemon-mcp

MCP server providing persistent layered memory for AI agents.
SQLite + FTS5 backend, zero-cloud, stdio transport.

Part of the Mnemon ecosystem. KB lives in `~/dev/mnemon-kb`.

## Commands

```bash
npm run build      # compile TypeScript → dist/
npm run dev        # run via tsx (no build needed)
npm start          # run compiled dist/index.js
npm test           # vitest (14 unit tests, md-parser)
npm run import:kb  # import mnemon-kb markdown → SQLite
```

Full import with force:
```bash
npx tsx src/import/cli.ts --kb-path ~/dev/mnemon-kb --force
```

## Tech Stack

| Tool | Version | Purpose |
|------|---------|---------|
| TypeScript | 5.9 | Strict mode, NodeNext modules |
| better-sqlite3 | 12.6 | Synchronous SQLite (ideal for MCP stdio) |
| @modelcontextprotocol/sdk | 1.27 | MCP server framework |
| vitest | 3.2 | Test runner |
| tsx | 4.21 | TypeScript execution without build step |

## Architecture

```
src/
  index.ts              MCP server entry (stdio transport, tool dispatch)
  db.ts                 SQLite schema, migrations, indexes, FTS5 triggers
  types.ts              TypeScript types (mirrors SQLite schema)
  tools/
    memory-add.ts       Insert memory, auto-supersede on source_file match
    memory-search.ts    FTS5 search with layer/scope/date filtering
    memory-update.ts    In-place update or superseding chain
    memory-inspect.ts   Layer stats or single-memory history trace
    memory-export.ts    [STUB] Export to json/markdown
    style-extract.ts    [STUB] Writing style analysis
  import/
    cli.ts              CLI entry for KB import
    kb-config.ts        Import routing rules (which files → which layer)
    kb-import.ts        Bulk import engine (hash-based dedup)
    md-parser.ts        Markdown → memory records splitter
    __tests__/
      md-parser.test.ts 14 unit tests
```

## Database

- **Path:** `~/.mnemon-mcp/memory.db`
- **WAL mode**, foreign keys ON, busy_timeout 5000ms
- **Tables:** memories, sessions, import_log, event_log
- **FTS5:** `memories_fts` synced via INSERT/UPDATE/DELETE triggers
- **Partial indexes:** exclude superseded entries from search
- **Tokenizer:** unicode61 (Cyrillic + Latin, NOT Thai-friendly)

## 4-Layer Memory Model

| Layer | Access pattern | Staleness | Examples |
|-------|---------------|-----------|----------|
| episodic | By date/period | Never expires | Journal, session notes |
| semantic | By topic/entity | 30-90 days | Facts, people, beliefs |
| procedural | Loaded at startup | Rare updates | CLAUDE.md rules |
| resource | On demand | Static | Book summaries, references |

## MCP Tools

| Tool | Status | Description |
|------|--------|-------------|
| memory_add | Working | Insert with auto-supersede on source_file match |
| memory_search | Working | FTS5 with layer/entity/date/scope filters |
| memory_update | Working | In-place or superseding chain |
| memory_inspect | Working | Stats per layer or single memory history |
| memory_export | Stub | Throws "not implemented" |
| style_extract | Stub | Throws "not implemented" |

## MCP Config

In `~/.claude/mcp.json`:
```json
{
  "mcpServers": {
    "mnemon-mcp": {
      "command": "node",
      "args": ["/Users/nikitagorokhov/dev/mnemon-mcp/dist/index.js"]
    }
  }
}
```

## Key Files in mnemon-kb

| File | Purpose |
|------|---------|
| `ai-tools/mnemon-mcp-schema.md` | Full SQLite schema reference |
| `ai-tools/mnemon-roadmap-2026-03.md` | Roadmap and architecture decisions |
| `eval/EVAL-SPEC.md` | Eval framework spec (L0-L3) |
| `eval/data/golden_set.json` | 50 test cases for retrieval quality |
| `eval/scripts/step2_retrieval.py` | L2 eval — queries this DB directly |

## Known Issues

1. **Russian morphology breaks FTS5** — prefix matching fails on inflected forms. Need Snowball stemmer
2. **Import scope too narrow** — 21/50 golden set cases blocked
3. **L2 retrieval = 38.1/100** — below 0.3 Recall@5 threshold
4. **No integration tests** — only md-parser unit tests
5. **hybrid mode = alias for fts** — no real semantic search
6. **No cycle protection** in superseding chains

## Superseding Chain

When `memory_update(supersede=true)`:
1. New entry created with `supersedes = old.id`
2. Old entry's `superseded_by` set to new entry's id
3. Partial indexes exclude old entry from search
4. No cycle protection yet (known issue)

## Conventions

- Commit format follows global CLAUDE.md: `verb: description`
- Push to `origin` (https://github.com/nikitacometa/mnemon-mcp.git)
- Build before committing if src/ changed: `npm run build`
- Run tests before committing: `npm test`
