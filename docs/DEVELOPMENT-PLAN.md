# mnemon-mcp — План разработки по майлстоунам

**Дата:** 2026-03-13
**Методология:** синтез 4 независимых экспертных аудитов (архитектура, продукт, search/retrieval, QA) + рыночное исследование

---

## Принцип фильтрации предложений

Каждое предложение из ULTIMATE-GUIDE.md прошло через 4 эксперта. Финальный вердикт — консенсус, а не голосование. Ключевые расхождения и их разрешение задокументированы.

### Что ОТКЛОНЕНО (и почему)

| Предложение | Эксперты за | Эксперты против | Решение | Причина |
|-------------|------------|-----------------|---------|---------|
| **Prepared statement cache (WeakMap)** | 0/4 | Arch | REJECT | better-sqlite3 уже кеширует `db.prepare()` внутри. WeakMap — лишний слой без измеримого выигрыша |
| **HyPE query expansion** | 0/4 | Product, Search, Arch | REJECT | Статические шаблоны не закрывают vocabulary gap для FTS5. AND→OR fallback + stemming уже дают 80% HyPE. 200% сложности за 10% прироста |
| **FTS5 content-synced mode** | 0/4 | Arch, Search | REJECT | FTS5 хранит `stemmed_content`, не оригинал — `content=memories` несовместимо с текущей schema. При 268 записях экономия пространства нерелевантна |
| **Entity graph (aliases + relations)** | 0/4 | Arch, Product | REJECT | Два новых стола + API управления — отдельный продукт, не фича. Entity aliases (без графа) — достаточно |
| **Cross-session consolidation** | 0/4 | Arch, Product, Search | REJECT | Без LLM — false merges. С LLM — зависимость + latency. Нужен rollback-механизм, расписание, отдельный процесс. Слишком рано |
| **Batch access_count (json_each)** | 0/4 | Arch | REJECT | `WHERE id IN (?, ?, ...)` нормально для limit=10. Усложнение SQL без пользы |
| **4-factor scoring formula** | 0/4 | Search | REJECT | 50 golden cases недостаточно для калибровки 4 параметров. Frequency (access_count) создаёт popularity bias |

### Ключевые расхождения между экспертами

**FTS5 snippet():**
- Product: SHIP IT (улучшает UX)
- Architecture + Search: BROKEN — FTS5 индексирует `stemmed_content`, snippet() вернёт стеммированные слова (`субличн`, `medit`), не оригинальные
- **Решение:** DEFER до решения проблемы dual-index. Тем временем улучшить `makeSnippet()` через LIKE-based match position

**sqlite-vec hybrid search:**
- Product: SKIP (ломает zero-deps, нет user demand, конфигурационный ад)
- Architecture: IMPLEMENT с оговорками (embedding как отдельный процесс)
- Search: Только если оставшиеся failures после import scope — vocabulary mismatch
- **Решение:** DEFER to M4, УСЛОВНЫЙ — реализовать только после измерения L2 post-import. Архитектура: внешний embedder, FTS5 fallback

**Decay scoring:**
- Product + Architecture: SHIP IT (дифференциатор, нет у конкурентов)
- Search: ОПАСНО для фактов — `"какой рост у Никиты?"` через 6 мес получит recency=0.016. Decay обоснован ТОЛЬКО для episodic layer
- **Решение:** IMPLEMENT, но ТОЛЬКО для episodic/resource. Semantic и procedural — без decay (факты и правила не "забываются")

**Scoring formula:**
- Search expert: единственное полезное изменение — расширить диапазон importance: `0.3 + 0.7 * importance` (диапазон 0.3–1.0) вместо `0.5 + 0.5 * importance` (диапазон 0.5–1.0)
- **Решение:** IMPLEMENT это одно изменение, без recency/frequency

---

## Майлстоун 0: Дистрибуция

**Scope:** npm publish + registry listing
**Effort:** 1-2 часа
**Зависимости:** нет

### Задачи

1. `npm publish` — `package.json` уже настроен (bin, files, engines). Барьер для 80% пользователей — `git clone + npm install + npm run build`
2. Registry listing: Smithery, mcp.so, PulseMCP — органический discovery. Context7 получает 11K views/week только от registry visibility
3. Smithery показывает серверы в Claude.ai UI — zero-effort adoption

### Валидация

- `npm pack --dry-run` — проверить что нет `.env`, `*.db`, `docs/COMPETITORS.md`
- `npx mnemon-mcp` — запускается без ошибок
- Smoke: `echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | npx mnemon-mcp`

### Блокирует

M1–M5 (пользователи не смогут обновляться через `npm update` без публикации)

---

## Майлстоун 1: Foundation — баги + технический долг

**Scope:** исправление 5 багов, дедупликация кода, оптимизация inspectLayerStats
**Effort:** 1 сессия (2-3 часа)
**Зависимости:** нет

### Задачи

| # | Задача | Файл | Effort |
|---|--------|------|--------|
| 1 | Fix FTS pagination `limit*2` → `(limit+offset)*2` | `memory-search.ts:278` | 10 min |
| 2 | Add `"deleted"` to `EventType` | `types.ts:77` | 5 min |
| 3 | Fix `memory://recent`: `COALESCE(updated_at, created_at) >= ?` | `server.ts:217` | 5 min |
| 4 | Don't inherit expired `expires_at` on supersede | `memory-update.ts:203` | 15 min |
| 5 | Replace `SELECT *` with explicit columns in inspectById | `memory-inspect.ts:49` | 10 min |
| 6 | Extract `insertMemory()` helper to `utils.ts` | `memory-add.ts`, `memory-update.ts` | 30 min |
| 7 | Move `generateId()` to `utils.ts` | `memory-add.ts:13`, `memory-update.ts:14` | 5 min |
| 8 | inspectLayerStats: CTE for top_entities (5→2 queries) | `memory-inspect.ts:155-178` | 20 min |

### Тесты (TDD — написать ДО фиксов)

```typescript
// Баг 1: pagination при offset > limit
it("offset larger than limit returns correct slice", () => {
  // Seed 25 memories, search offset=20 limit=3
  const page = memorySearch(db, { query: "...", mode: "exact", limit: 3, offset: 20 });
  // Должен вернуть записи [20, 21, 22]
});

// Баг 4: supersede не наследует expired TTL
it("superseding entry gets null expires_at when original was expired", () => {
  const old = memoryAdd(db, { content: "old", layer: "semantic", ttl_days: 1 });
  db.prepare("UPDATE memories SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(old.id);
  const result = memoryUpdate(db, { id: old.id, supersede: true, new_content: "new" });
  const row = db.prepare("SELECT expires_at FROM memories WHERE id = ?").get(result.new_id!);
  expect(row.expires_at).toBeNull();
});

// Баг 5: inspectById не утекает stemmed колонки
it("inspectById response does not contain stemmed_content", () => {
  const added = memoryAdd(db, { content: "test", layer: "semantic" });
  const result = memoryInspect(db, { id: added.id });
  expect(result.memory).not.toHaveProperty("stemmed_content");
  expect(result.memory).not.toHaveProperty("stemmed_title");
});
```

### Валидация после M1

| Метрика | До | После |
|---------|-----|-------|
| Tests | 67 | ≥75 |
| FTS page(limit=3, offset=20) | пустой массив | корректный slice |
| inspectById response | утекают stemmed_* | только public columns |
| Benchmark baseline | — | зафиксировать (`npm run bench`) |

### Code review focus

- `insertMemory()` helper покрыт типами, не принимает `unknown`
- `expires_at` logic при supersede — явная документация в JSDoc
- `EventType` и CHECK constraint в `event_log` синхронизированы

---

## Майлстоун 2: Search Quality + Analytics

**Scope:** расширение импорта, decay scoring, scoring formula, analytics, contradiction detection
**Effort:** 1-2 сессии
**Зависимости:** M1 (insertMemory helper)

### Задачи

| # | Задача | Impact | Effort |
|---|--------|--------|--------|
| 1 | **Import scope expansion** (nutrition, habits, journal, finance) | Recall@5 0.298→~0.46 | 1 hr |
| 2 | **Decay scoring** — ТОЛЬКО для episodic и resource layers | Дифференциация | 1 hr |
| 3 | **Importance weight** — `0.3 + 0.7 * importance` (wider range) | Ranking quality | 10 min |
| 4 | **Memory analytics** в inspect: stale_count, never_accessed, avg_age | Diagnostics | 1 hr |
| 5 | **Contradiction detection** — FTS WARN на memory_add (entity_name only) | Data quality | 1-2 hr |

### Decay scoring — архитектура

```typescript
// ТОЛЬКО для episodic и resource layers
// semantic и procedural — decay = 1.0 (факты и правила не забываются)
const DECAY_HALF_LIFE_DAYS: Record<Layer, number | null> = {
  episodic: 30,    // сессии забываются за 30 дней
  resource: 90,    // справочный материал — за 90 дней
  semantic: null,  // факты НЕ забываются
  procedural: null // правила НЕ забываются
};

function decayFactor(layer: Layer, daysSinceAccess: number): number {
  const halfLife = DECAY_HALF_LIFE_DAYS[layer];
  if (halfLife === null) return 1.0; // no decay
  return Math.exp(-Math.LN2 * daysSinceAccess / halfLife);
}

// Итоговая формула:
// score = bm25_normalized * (0.3 + 0.7 * importance) * decayFactor(layer, days)
```

### Contradiction detection — архитектура

```typescript
// Только при наличии entity_name (иначе false positive rate > 50%)
// FTS поиск по entity_name + ключевые токены content
// Если overlap > threshold → вернуть warnings: [{ type: "potential_contradiction", ... }]
// НЕ блокирует вставку — только предупреждение
```

### Тесты (TDD)

```typescript
// Decay: episodic memory scores lower when old
it("older episodic memory scores lower than newer", () => {
  const old = memoryAdd(db, { content: "session notes", layer: "episodic" });
  db.prepare("UPDATE memories SET created_at = '2020-01-01' WHERE id = ?").run(old.id);
  const recent = memoryAdd(db, { content: "session notes", layer: "episodic" });
  const result = memorySearch(db, { query: "session notes" });
  // recent выше old
});

// Decay: semantic memory НЕ теряет score
it("old semantic memory retains full score", () => {
  const fact = memoryAdd(db, { content: "blood type A+", layer: "semantic" });
  db.prepare("UPDATE memories SET created_at = '2020-01-01' WHERE id = ?").run(fact.id);
  const result = memorySearch(db, { query: "blood type" });
  expect(result.memories.some(m => m.id === fact.id)).toBe(true);
});

// Contradiction: предупреждение при конфликтующих фактах
it("memory_add warns when contradicting fact exists for same entity", () => {
  memoryAdd(db, { content: "prefers tabs", layer: "semantic", entity_name: "nikita" });
  const result = memoryAdd(db, { content: "prefers spaces", layer: "semantic", entity_name: "nikita" });
  expect(result.potential_conflicts).toBeDefined();
  expect(result.potential_conflicts!.length).toBeGreaterThan(0);
});
```

### Валидация после M2

| Метрика | До | Цель |
|---------|-----|------|
| L2 Recall@5 | 0.298 | ≥0.45 |
| Golden set coverage | 29/50 | ≥40/50 |
| Tests | ≥75 | ≥85 |
| Benchmark p99 FTS | baseline | ≤baseline (decay = SQL arithmetic, не I/O) |

**Как измерить:** `python3 eval/scripts/run_eval.py --step 2` до и после. Diff сохранить в `docs/eval-results-m2.txt` (не коммитить).

### Code review focus

- Decay НЕ применяется к semantic/procedural (critical invariant)
- Contradiction detection использует `entity_name` как первичный фильтр (не O(N) full scan)
- Import scope: новые директории с `scope: "personal"` (не `global`)

---

## Майлстоун 3: Testing + Robustness

**Scope:** тестовое покрытие import pipeline, 12 priority tests, рефакторинг OR-fallback
**Effort:** 1 сессия
**Зависимости:** M2 (import scope changes need tests)

### Задачи

| # | Задача | Impact | Effort |
|---|--------|--------|--------|
| 1 | Import pipeline tests (0%→60%): processFile, hash dedup, frontmatter override | Quality | 2 hr |
| 2 | Resources/Prompts tests: memory://stats, memory://recent, memory://layer | Coverage | 1 hr |
| 3 | FTS pagination edge cases (offset > limit, offset=0, offset=total) | Regression | 30 min |
| 4 | OR-fallback refactor: named params instead of `params.slice(1)` | Robustness | 30 min |
| 5 | Frontmatter parser: handle colons in values | Fix | 15 min |

### Import pipeline tests (fixtures)

```typescript
// src/import/__tests__/kb-import.test.ts

it("imports whole file as single memory", () => { ... });
it("splits file by h2 headings", () => { ... });
it("skips unchanged file (hash dedup)", () => { ... });
it("frontmatter layer override takes precedence", () => { ... });
it("dry run does not write to DB", () => { ... });
it("records error on unreadable file", () => { ... });
it("entity_name from-heading extracts correctly", () => { ... });
```

### Валидация после M3

| Метрика | До | Цель |
|---------|-----|------|
| Import pipeline coverage | 0% | ≥60% |
| Total tests | ≥85 | ≥95 |
| OR-fallback: fragile params | yes | named params |
| Frontmatter colons | broken | fixed |

### Code review focus

- `globSync` поведение macOS vs Linux (CI)
- Fixture файлы: минимальные, не реальные KB файлы
- OR-fallback: новая конструкция params должна быть testable отдельно

---

## Майлстоун 4: Optional Vector Search (УСЛОВНЫЙ)

**Scope:** sqlite-vec + внешний embedder + hybrid search
**Effort:** 2-3 сессии
**Зависимости:** M2 (L2 метрики post-import)

### Условие запуска

**НЕ начинать M4 пока не выполнены ОБА условия:**
1. L2 Recall@5 после M2 измерен
2. Анализ оставшихся failures показывает vocabulary mismatch (не отсутствие данных)

Если оставшиеся failures — это "запрос точный, документ есть, но FTS не нашёл из-за разных формулировок" → M4 обоснован. Если failures — "документа нет" или "опечатка" → M4 не поможет.

### Архитектура: "zero-deps base, optional enhancement"

```
┌─────────────────────────────────────────────┐
│  mnemon-mcp (core)                          │
│  FTS5 search ← always works, zero deps     │
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │  Vector module (optional)            │    │
│  │  Activated when MNEMON_EMBEDDING_URL │    │
│  │  or OPENAI_API_KEY is set           │    │
│  │                                      │    │
│  │  Embeddings: external process        │    │
│  │  Storage: memories.embedding BLOB    │    │
│  │  Fusion: RRF (k=60)                 │    │
│  │  Fallback: FTS5 when <50% embedded  │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

**Принципы:**
- `embedding BLOB` уже есть в schema — нет миграции
- Embedding считается асинхронно, НЕ в MCP tool (не блокировать stdio)
- CLI: `npx mnemon-mcp embed` — заполняет embedding BLOB
- Если < 50% записей имеют embedding → только FTS5 (RRF на неполных данных смещён)
- `mode: "hybrid"` работает только при наличии embeddings, иначе silently fallback to FTS5

**Env vars:**
- `MNEMON_EMBEDDING_URL` — URL для custom embedding API
- `OPENAI_API_KEY` — OpenAI text-embedding-3-small (default provider)
- Ни один из них не обязателен. Без них — чистый FTS5

### Тесты

```typescript
// Всё работает БЕЗ API ключа
it("memory_search returns FTS5 results when vector unavailable", () => {
  const result = memorySearch(db, { query: "test" });
  expect(result.memories.length).toBeGreaterThan(0);
});

// RRF fusion корректно ранжирует
it("RRF fusion reranks FTS and vector results", () => {
  const fused = rrfFusion(ftsResults, vecResults, { k: 60 });
  // Items appearing in both lists rank higher
});

// Graceful fallback при < 50% embedded
it("falls back to FTS when insufficient embeddings", () => {
  // Only 10% of memories have embeddings
  const result = memorySearch(db, { query: "test", mode: "hybrid" });
  expect(result.search_mode_used).toBe("fts");
});
```

### Валидация

| Метрика | До | Цель |
|---------|-----|------|
| Recall@5 (с embeddings) | 0.45 | ≥0.60 |
| Tests без OPENAI_API_KEY | все pass | все pass |
| Hybrid p99 | — | ≤3x FTS baseline |
| LongMemEval subset (100 questions) | — | baseline captured |

### Риски

- `sqlite-vec` — нативная зависимость. `node-gyp` может не собраться без system deps. CI проверяет только fallback
- OpenAI embedding API latency ~100ms/request. Нужен batching (100/request) + retry
- Model drift: при обновлении модели все старые embeddings несовместимы. Сохранять `model_id` в meta

---

## Майлстоун 5: Advanced Features + npm publish

**Scope:** temporal fact windows, entity aliases, memory health, npm publish
**Effort:** 2 сессии
**Зависимости:** M3

### Задачи

| # | Задача | Impact | Effort |
|---|--------|--------|--------|
| 1 | Temporal fact windows (`valid_from`/`valid_until`) | Дифференциация | 1.5 hr |
| 2 | Entity aliases (таблица `entity_aliases`, resolution при search) | Search quality | 1 hr |
| 3 | Memory health report в inspect (stale, never_accessed, decay prediction) | Diagnostics | 1 hr |
| 4 | LongMemEval benchmark setup (subset 100, baseline capture) | Credibility | 2 hr |

### Temporal windows — архитектура

```sql
-- Migration v4
ALTER TABLE memories ADD COLUMN valid_from TEXT;
ALTER TABLE memories ADD COLUMN valid_until TEXT;
```

Search получает опциональный `as_of` параметр:
```sql
WHERE (valid_from IS NULL OR valid_from <= ?)
  AND (valid_until IS NULL OR valid_until >= ?)
```

**Приоритет ограничений:** `expires_at` (TTL, системный) > `valid_until` (семантический, пользовательский) > `superseded_by`

### Entity aliases — архитектура

```sql
CREATE TABLE entity_aliases (
  canonical TEXT NOT NULL,
  alias TEXT NOT NULL UNIQUE,
  PRIMARY KEY (canonical, alias),
  CHECK (alias != canonical)
);
```

При `memory_search(entity_name="nick")` → lookup alias → search by canonical "nikita".

### Валидация

| Метрика | До | Цель |
|---------|-----|------|
| Temporal retrieval (5 as_of queries) | — | 100% correct |
| Alias resolution | — | ≥3 tests passing |
| Health report stale detection | — | ≥80% true positive |
| `npm publish --dry-run` | — | 0 unexpected files |

---

## Сводная таблица

| M | Название | Effort | Тесты до/после | Key metric | Benchmark |
|---|----------|--------|-----------------|-----------|-----------|
| M0 | Distribution | 1-2 hr | — | npm install works | — |
| M1 | Foundation | 2-3 hr | +5 TDD / +3 regression | 0 leaked columns | Baseline capture |
| M2 | Search Quality | 4-6 hr | +6 TDD / +4 regression | Recall@5 ≥0.45 | p99 ≤baseline |
| M3 | Testing | 3-4 hr | +8 import / +4 resources | 95+ tests | stable |
| M4 | Vector (условный) | 8-12 hr | +4 fallback+RRF / +3 | Recall@5 ≥0.60 | hybrid ≤3x FTS |
| M5 | Advanced | 5-6 hr | +5 temporal+alias | temporal 100% | LongMemEval baseline |

---

## Правила валидации для каждого майлстоуна

### Before implementing

1. Написать failing tests (TDD) для каждого бага/фичи
2. Запустить `npm run bench` и сохранить baseline
3. Запустить `npm test` — текущие 67+ тестов проходят

### After implementing

1. Все новые + старые тесты проходят: `npm test`
2. Benchmark не деградировал: `npm run bench` (сравнить с baseline)
3. Build проходит: `npm run build`
4. Smoke test: `echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/index.js`
5. L2 eval (M2+): `python3 eval/scripts/run_eval.py --step 2`

### Code review checklist

- [ ] Нет `console.log()` в MCP tools (только `console.error()`)
- [ ] Нет `SELECT *` — явные списки колонок
- [ ] Новые SQL миграции idempotent (IF NOT EXISTS, ALTER TABLE IF NOT EXISTS)
- [ ] Zod schema и JSON Schema синхронизированы
- [ ] Types в `types.ts` отражают реальную schema
- [ ] Нет дублирования INSERT/generateId
- [ ] Тест может упасть (kill-the-mutant check)

---

## LongMemEval — когда запускать

| Момент | Что | Зачем |
|--------|-----|-------|
| После M2 | L2 golden set (50 queries, 2 мин) | Валидировать impact import scope |
| После M4 | LongMemEval subset (100 queries, 20 мин) | Первый real benchmark hybrid search |
| После M5 | Полный LongMemEval (500 queries) | Публичная цифра для npm/GitHub |

**Не запускать** LongMemEval до M4 — без semantic search результат ~35-40%, не информативен.

---

## Целевые метрики (3 месяца)

| Метрика | Сейчас | После M2 | После M4 | Целевое |
|---------|--------|----------|----------|---------|
| L2 Retrieval | 36.9/100 | 55+/100 | 70+/100 | 75/100 |
| Recall@5 | 0.298 | 0.45+ | 0.60+ | 0.70 |
| Tests | 67 | 85+ | 90+ | 100+ |
| npm weekly downloads | 0 | 50+ | 100+ | 200+ |
| LongMemEval | — | — | baseline | 65%+ |
