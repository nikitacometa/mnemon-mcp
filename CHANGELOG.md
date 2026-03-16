# Changelog

All notable changes to mnemon-mcp will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-03-17

### Added
- **Session lifecycle tools**: `memory_session_start`, `memory_session_end`, `memory_session_list` — group episodic memories by agent session with client, project, and summary tracking
- **Search query logging** — `search_log` table (migration v5) for query observability: query text, mode, result count, duration
- **Recency boost** in FTS scoring: `1 / (1 + daysSince / 365)` rewards recently created memories
- **Query-centered snippets** — search results highlight the first matched term instead of always starting from content beginning
- 12 new integration tests for session lifecycle (194 total: 17 md-parser + 13 kb-import + 123 integration + 41 validation)

### Fixed
- Pagination with `min_confidence`/`min_importance` filters: moved from JS post-filter to SQL WHERE (fixes empty pages at high offsets)
- `memory_health` cleanup: chain repair now correctly reactivates predecessors when superseding entry is deleted
- Contradiction detection: properly handles edge case where superseded memory matches source_file
- Removed dead `conflicting` variable in memory-add

## [1.0.1] - 2026-03-16

### Added
- MCP Registry manifest (`server.json`) for official registry submission
- `mcpName` field in package.json for registry verification
- Landing page link in README
- Demo GIF with VHS recording scripts

### Changed
- Homepage URL updated to landing page (aisatisfy.me/mnemon/)

## [1.0.0] - 2026-03-16

### Added
- 4-layer memory model: episodic, semantic, procedural, resource
- 7 MCP tools: `memory_add`, `memory_search`, `memory_update`, `memory_delete`, `memory_inspect`, `memory_export`, `memory_health`
- FTS5 full-text search with BM25 ranking and AND→OR fallback
- Snowball stemming for English and Russian at index and query time
- Progressive AND relaxation for complex multi-token queries
- Fact versioning via superseding chains
- Markdown knowledge base import pipeline with configurable routing
- Temporal fact windows (valid_from / valid_until) and entity aliases
- Memory decay scoring (episodic: 30-day, resource: 90-day half-life)
- Contradiction detection on memory_add
- `memory_health` tool: diagnostic report with expired entries, orphaned chains, stale memories, and optional GC
- MCP Resources (stats, recent, layer, entity) and Prompts (recall, context-load, journal)
- HTTP transport with Bearer auth, CORS, rate limiting, body size limits, graceful shutdown
- Optional vector search with BYOK embeddings (OpenAI, Ollama) via sqlite-vec
- Hybrid search mode combining FTS5 + vector via Reciprocal Rank Fusion (RRF)
- Tool input schemas generated from Zod via `z.toJSONSchema()` — single source of truth
- Import config with Zod validation
- 182 tests (unit + integration + validation)
- CI pipeline with build, test, and smoke tests

[Unreleased]: https://github.com/nikitacometa/mnemon-mcp/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/nikitacometa/mnemon-mcp/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/nikitacometa/mnemon-mcp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/nikitacometa/mnemon-mcp/releases/tag/v1.0.0
