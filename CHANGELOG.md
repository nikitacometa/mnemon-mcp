# Changelog

All notable changes to mnemon-mcp will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/nikitacometa/mnemon-mcp/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/nikitacometa/mnemon-mcp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/nikitacometa/mnemon-mcp/releases/tag/v1.0.0
