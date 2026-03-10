# Mnemon MCP — Full Audit & Implementation Plan

**Date**: 2026-03-10
**Scope**: 5-agent parallel audit — architecture, KB/eval, SOTA research, meta-setup, MCP ecosystem
**Status**: Approved, execution starts with Phase 0

---

## Executive Summary

Architecture is strong — 4-layer memory model is unique among competitors (Mem0, Zep, Letta, official MCP memory). Code is strict TypeScript with good SQLite schema design. But infrastructure around the code has critical gaps: zero integration tests, zero CI, smoke tests destroy production data, no backup strategy for 173 live memories. Additionally, FTS query strategy accounts for 50% of L2 eval failures independently of import scope.

---

## Critical Findings

| # | Issue | Source | Impact |
|---|-------|--------|--------|
| C1 | No runtime validation of MCP tool args — `as unknown as T` in `index.ts` | Code audit | Invalid data reaches SQLite, NaN dates, broken chains |
| C2 | FTS AND-query with navigational words fails 12/50 golden set cases | Eval audit | L2 score suppressed regardless of import scope |
| C3 | Zero integration tests for core tools (add/search/update/inspect) | Meta audit | Any change risks silent regression |
| C4 | Smoke tests `rm -f ~/.mnemon-mcp/memory.db` — destroys production data | Meta audit | Catastrophic data loss on test run |
| C5 | No backup strategy for memory.db (173 active memories) | Meta audit | Single point of failure |
| C6 | `expires_at` never checked in search — expired memories returned forever | Code audit | Stale data pollutes results |
| C7 | Stubs (`memory_export`, `style_extract`) registered as working tools | Code audit | Agent retry loops on invocation |

---

## Major Findings

### Code Quality

| # | Issue | File | Details |
|---|-------|------|---------|
| M1 | `escapeFtsToken` misses `():-` and FTS5 operators `OR/AND/NOT` | memory-search.ts | Silent empty results or syntax errors |
| M2 | Superseding chain: `supersedes` references only last of N old records | memory-add.ts | History chain breaks with multiple superseded |
| M3 | Can supersede already-dead entry (no `superseded_by IS NULL` check) | memory-update.ts | Chain corruption |
| M4 | `processFile` has no try/catch around `memoryAdd` | kb-import.ts | Unhandled exception kills entire import run |
| M5 | `access_count` not updated on search (main read path) | memory-search.ts | LRU/LFU metrics useless |
| M6 | `logEvent` on supersede doesn't save `old_content` | memory-add.ts | Audit trail incomplete |
| M7 | No schema versioning (no `schema_version` table) | db.ts | M2 stemmer migration requires ALTER TABLE |
| M8 | `generateId()` duplicated in memory-add.ts and memory-update.ts | DRY violation | |
| M9 | OR-fallback uses fragile `params.slice(1)` — breaks if filter order changes | memory-search.ts | |
| M10 | `total_found` is misleading — equals `memories.length`, not DB total | memory-search.ts | Agent pagination broken |
| M11 | Double superseded_by filter (SQL + JS) in ftsSearch, absent in exactSearch | memory-search.ts | Inconsistency |
| M12 | `makeSnippet` ignores FTS5 `highlight()`/`snippet()` built-ins | memory-search.ts | Irrelevant snippets for long docs |
| M13 | `ttl_days` without validation — `NaN` → `"Invalid DateZ"` in SQLite | memory-add.ts | |
| M14 | `sessions` table never used by any code | db.ts | Dead weight |
| M15 | `mkdirSync(DB_DIR)` ignores custom `dbPath` parameter | db.ts | Tests create unnecessary dirs |

### Eval & Import

| # | Issue | Impact |
|---|-------|--------|
| E1 | 60% of KB not imported — 21/50 golden set cases blocked | L2 capped at 46.3 even with perfect retrieval |
| E2 | Frontmatter `description` not indexed in FTS | "Human Design" unfindable despite being in frontmatter |
| E3 | Journal fileFilter `^2026-\d{2}-\d{2}\.md$` skips quarterly `2025-q*.md` | 4 TMP + 2 XRF cases blocked |
| E4 | 7+ golden set cases reference intentionally excluded files | Structural inconsistency — tests can never pass |
| E5 | Dead `workspace-snapshot/` mappings in kb-config.ts (dir removed in T-076) | Silent dead code |
| E6 | `telegram/channel-profile.md` not in SKIP_PATTERNS, not in DIRECTORY_MAPPINGS — silently orphaned | 3 golden set cases blocked |
| E7 | L3 eval not implemented (25% weight in composite score) | Composite score incomplete |
| E8 | L1 score not reported in metrics, temporal consistency check missing | Blind spot |
| E9 | Schema doc `mnemon-mcp-schema.md` outdated (missing event_log details) | Cross-project drift |

### Infrastructure

| # | Issue | Impact |
|---|-------|--------|
| I1 | No GitHub Actions CI | Build/test not automated |
| I2 | No pre-commit hooks | Broken code can be committed |
| I3 | `dist/` in gitignore but files tracked in git | Dirty working tree after every build |
| I4 | Hardcoded `~/dev/mnemon/mnemon-kb` in package.json | Non-portable |
| I5 | `memory` vs `mnemon-mcp` conflict in mcp.json — not delineated | Data divergence risk |
| I6 | No `engines` field in package.json (requires Node 22+) | Silent failure on older Node |
| I7 | No `.nvmrc` or `.node-version` | Environment mismatch |
| I8 | Test files compiled into `dist/` (no tsconfig.build.json) | Unnecessary artifacts |
| I9 | vitest config missing explicit `environment: "node"` | |
| I10 | No coverage thresholds configured | |
| I11 | Two smoke test files (`test-smoke.sh` + `test_smoke.py`) — no docs on which to use | |

---

## SOTA Research Summary

### Competitive Landscape

| System | Key Approach | mnemon-mcp Relevance |
|--------|-------------|---------------------|
| **Letta (ex-MemGPT)** | OS metaphor — core/recall/archival memory, sleep-time consolidation | Architecture closest to ours. T-079 = their sleep-time consolidation |
| **Zep/Graphiti** | Temporal knowledge graph, bi-temporal model, Neo4j/Kuzu | Bi-temporal richer than our superseding chain. Kuzu = embedded graph |
| **Mem0** | LLM-driven extraction + graph, J-score 68.41% on LoCoMo | Auto-extraction too expensive for our import pipeline |
| **LangGraph/LangMem** | Checkpointer (short-term) + store (long-term) | Conceptually matches our design |
| **Official MCP memory** | JSONL, entities + relations + observations | Our mnemon-mcp is significantly more capable |

### Key Insight from Letta Benchmark

> "Agent capability matters more than retrieval mechanism complexity" — simple file-based tools often outperform complex retrieval because LLMs understand them better. Our 4-layer model with explicit semantics is the right approach.

### Technology Recommendations

| Technology | What | Priority | Complexity |
|-----------|------|----------|-----------|
| `snowball-stemmer.jsx` | Pure JS Snowball stemmer for Russian | P0 (M2) | Low |
| `sqlite-vec` | Vector search extension for better-sqlite3 | P1 (M3) | High |
| `multilingual-e5-small` | Embedding model (120MB, 384-dim, local) | P1 (M3) | High |
| `BGE-M3` | Best multilingual embedding (570MB, 1024-dim) | P2 (M4) | High |
| `InMemoryTransport` | MCP SDK test transport — no subprocess needed | P0 (now) | Low |
| `MCP Inspector` | `npx @modelcontextprotocol/inspector` — visual debugging | P0 (now) | Zero |
| MCP Resources | `memory://stats`, `memory://layer/{layer}` | P1 (M3) | Medium |
| MCP `outputSchema` | Typed tool results for all tools | P1 (M3) | Low |
| MCP Prompts | `memory-daily-review`, `memory-topic-digest` templates | P2 | Low |

### Hybrid Search Consensus (2025-2026)

All production systems use BM25 + vector + RRF fusion. sqlite-vec is compatible with better-sqlite3:

```typescript
import * as sqliteVec from "sqlite-vec";
sqliteVec.load(db); // one call, adds vec0 virtual tables
```

RRF scoring: `score = 1/(60 + rank_fts) + 1/(60 + rank_vector)`

### Memory Decay Models

Stanford/Generative Agents formula: `score = recency × importance × relevance`
- Recency: exponential decay 0.995^hours
- Importance: LLM-assigned at write time (1-10)
- Relevance: cosine similarity to current query

For knowledge base (our case): half-life = months, not hours.

---

## Implementation Plan

### Phase 0 — Hygiene (pre-M2, 2-3 days)

**Goal**: Safety net before any architectural changes.

| Task | ID | Priority | Est |
|------|----|----------|-----|
| Input validation (zod) for all tool args in `index.ts` | T-081 | critical | 3h |
| Integration tests with `InMemoryTransport` for core tools | T-082 | critical | 6h |
| Pre-commit hook (`npm run build && npm test`) | T-083 | critical | 30m |
| Fix smoke tests — use `/tmp/mnemon-test.db` | T-084 | critical | 1h |
| DB backup script (`npm run db:backup`) | T-085 | high | 1h |
| Remove stubs from ListTools or mark `[NOT AVAILABLE]` | T-086 | high | 30m |
| Add `expires_at` filter to search queries | T-087 | high | 1h |
| Fix `escapeFtsToken` — escape `():-` and FTS5 operators | T-088 | high | 1h |
| Add `access_count` increment in `memory_search` | T-089 | medium | 30m |
| Fix `processFile` — add try/catch around `memoryAdd` | T-090 | high | 30m |

### Phase 1 — M2: Retrieval Quality (as planned, corrected)

**Goal**: L2 score > 50 (from 36.9). Two orthogonal improvements: query quality + scope expansion.

| Task | ID | Priority | Est |
|------|----|----------|-----|
| FTS query preprocessing — remove stop/navigational words | T-091 | critical | 4h |
| Snowball stemmer (`snowball-stemmer.jsx`) | M2 existing | high | 1d |
| Expand import scope: `nutrition/targets.md`, `habits/streaks.md`, `telegram/channel-profile.md`, `journal/2025-q*.md` | T-092 | high | 3h |
| Index frontmatter `description` in FTS content | T-093 | high | 2h |
| Fix golden set — remove/fix cases referencing excluded files | T-094 | medium | 2h |
| Remove dead `workspace-snapshot/` mappings from kb-config.ts | T-095 | low | 15m |
| Schema versioning — add `schema_version` table + migration runner | T-096 | high | 4h |
| FTS5 content table architecture for stemmed content | M2 existing | high | 4h |
| Full re-import + L2 eval | M2 existing | — | 1h |

### Phase 2 — M3: Infrastructure + Spec Compliance

**Goal**: Production-grade infrastructure, MCP spec adoption.

| Task | Priority | Est |
|------|----------|-----|
| GitHub Actions CI (build + test on push) | high | 2h |
| MCP Resources endpoint (`memory://stats`, `memory://layer/{layer}`) | medium | 4h |
| Tool `outputSchema` for all tools | medium | 3h |
| Importance scoring in search ranking | high | 4h |
| Resolve `memory` vs `mnemon-mcp` conflict in mcp.json | medium | 1h |
| Superseding chain fixes (cycle detection, dead-entry check) | high | 3h |
| Coverage thresholds in vitest config | medium | 1h |
| `tsconfig.build.json` to exclude tests from dist | low | 30m |

### Phase 3 — M4: Semantic Search

**Goal**: Hybrid search (BM25 + vector), memory decay.

| Task | Priority | Est |
|------|----------|-----|
| sqlite-vec integration with better-sqlite3 | high | 1d |
| Local embedding model (`multilingual-e5-small` via `@xenova/transformers`) | high | 1d |
| Hybrid search with RRF fusion | high | 1d |
| TTL-based exponential decay for episodic layer | medium | 4h |
| Consolidation worker (T-079) | high | 2-3d |
| L3 eval implementation (faithfulness + hallucination) | medium | 2d |

---

## Competitive Positioning

| Feature | mnemon-mcp | Official MCP memory | Mem0 | Zep/Graphiti |
|---------|-----------|---------------------|------|-------------|
| 4-layer model | **Yes** | No | No | 3 levels |
| Import pipeline + dedup | **Yes** | No | No | No |
| Superseding chains | **Yes** | No | No | Bi-temporal |
| Vector search | No → M4 | No | **Yes** | **Yes** |
| Knowledge graph | No | **Yes** (JSONL) | **Yes** | **Yes** (Neo4j) |
| Auto-extraction | No | No | **Yes** | **Yes** |
| Russian morphology | No → M2 | No | No | No |
| Zero-cloud | **Yes** | **Yes** | No | Partial |
| Test coverage | 5% → M2 | ~50% | ? | ? |
| BM25 ranking | **Yes** | No | No | **Yes** |
| Audit trail | **Yes** | No | No | Partial |

---

## Sources

### Agent Memory Systems
- [Letta Blog: Agent Memory](https://www.letta.com/blog/agent-memory)
- [Letta: Benchmarking AI Agent Memory](https://www.letta.com/blog/benchmarking-ai-agent-memory)
- [arxiv:2501.13956 — Zep temporal knowledge graph](https://arxiv.org/abs/2501.13956)
- [GitHub: getzep/graphiti](https://github.com/getzep/graphiti)
- [arxiv:2504.19413 — Mem0 paper](https://arxiv.org/abs/2504.19413)
- [LangMem SDK launch](https://blog.langchain.com/langmem-sdk-launch/)
- [arxiv:2512.13564 — Memory in the Age of AI Agents](https://arxiv.org/abs/2512.13564)

### MCP Ecosystem
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [Anthropic: Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [GitHub: MCP server-memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)
- [mcp-memory-enhanced (91% test coverage)](https://github.com/JamesPrial/mcp-memory-enhanced)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
- [MCP best practices](https://www.philschmid.de/mcp-best-practices)

### Search & NLP
- [GitHub: asg017/sqlite-vec](https://github.com/asg017/sqlite-vec)
- [sqlite-vec JS docs](https://alexgarcia.xyz/sqlite-vec/js.html)
- [HuggingFace: BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3)
- [npm: snowball-stemmer.jsx](https://www.npmjs.com/package/snowball-stemmer.jsx)
- [Oracle: Agent Memory decay models](https://blogs.oracle.com/developers/agent-memory-why-your-ai-has-amnesia-and-how-to-fix-it)
