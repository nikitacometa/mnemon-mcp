# Changelog

All notable changes to mnemon-mcp will be documented in this file.

## [Unreleased]

### Added
- Optional vector search with BYOK embeddings (OpenAI, Ollama)
- sqlite-vec integration for cosine similarity KNN search
- Hybrid search mode combining FTS5 + vector via Reciprocal Rank Fusion (RRF)
- `mode: "vector"` and `mode: "hybrid"` options in memory_search
- Auto-embed on memory_add when embedding provider is configured
- Embedder abstraction with OpenAI and Ollama providers
- New env vars: MNEMON_EMBEDDING_PROVIDER, MNEMON_EMBEDDING_API_KEY, MNEMON_EMBEDDING_MODEL, MNEMON_EMBEDDING_DIMENSIONS, MNEMON_OLLAMA_URL

## [1.0.0] - 2026-03-15

### Added
- 4-layer memory model: episodic, semantic, procedural, resource
- FTS5 full-text search with BM25 ranking and AND→OR fallback
- Snowball stemming for English and Russian at index and query time
- Fact versioning via superseding chains
- Markdown knowledge base import pipeline with configurable routing
- Temporal fact windows (valid_from / valid_until) and entity aliases
- Memory decay scoring (episodic: 30-day, resource: 90-day half-life)
- Contradiction detection on memory_add
- MCP Resources (stats, recent, layer, entity) and Prompts (recall, context-load, journal)
- HTTP transport with Bearer auth, body size limits, graceful shutdown
- 167 tests (unit + integration + validation)
- CI pipeline with build, test, and smoke tests
- Import config with Zod validation
