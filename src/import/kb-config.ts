/**
 * KB import configuration — directory-to-layer mapping, split strategies, defaults.
 * Mirrors memory-layer-mapping.md from mnemon-kb spec.
 */

import type { EntityType, Layer } from "../types.js";

export interface FileMapping {
  layer: Layer;
  entity_type: EntityType;
  importance: number;
  confidence: number;
  split: "whole" | "h2" | "h3";
  /** entity_name to use; "from-heading" extracts from H2/H3 heading text */
  entity_name?: string | "from-heading";
  scope?: string;
}

export interface DirectoryMapping extends Omit<FileMapping, "split"> {
  /** glob pattern relative to KB root */
  glob: string;
  split: "whole" | "h2" | "h3";
  /** filter function for filenames (e.g. only 2026-*.md) */
  fileFilter?: (filename: string) => boolean;
}

/** Directory-level defaults */
export const DIRECTORY_MAPPINGS: DirectoryMapping[] = [
  // ── Semantic (P1) ──
  {
    glob: "self-model/*.md",
    layer: "semantic",
    entity_type: "user",
    entity_name: "nikita",
    importance: 0.9,
    confidence: 0.9,
    split: "h2",
  },
  {
    glob: "beliefs/*.md",
    layer: "semantic",
    entity_type: "user",
    entity_name: "nikita",
    importance: 0.9,
    confidence: 0.9,
    split: "h2",
  },
  {
    glob: "people/people.md",
    layer: "semantic",
    entity_type: "person",
    entity_name: "from-heading",
    importance: 0.8,
    confidence: 0.8,
    split: "h3",
  },
  {
    glob: "projects/projects.md",
    layer: "semantic",
    entity_type: "project",
    entity_name: "from-heading",
    importance: 0.7,
    confidence: 0.8,
    split: "h2",
  },
  {
    glob: "knowledge/books.md",
    layer: "semantic",
    entity_type: "concept",
    entity_name: "from-heading",
    importance: 0.6,
    confidence: 0.8,
    split: "h2",
  },
  {
    glob: "knowledge/knowledge.md",
    layer: "semantic",
    entity_type: "concept",
    entity_name: "from-heading",
    importance: 0.6,
    confidence: 0.8,
    split: "h2",
  },

  // ── Semantic — Health & Habits ──
  {
    glob: "nutrition/targets.md",
    layer: "semantic",
    entity_type: "user",
    entity_name: "nikita",
    importance: 0.7,
    confidence: 0.9,
    split: "h2",
  },
  {
    glob: "habits/streaks.md",
    layer: "semantic",
    entity_type: "user",
    entity_name: "nikita",
    importance: 0.7,
    confidence: 0.9,
    split: "h2",
  },

  // ── Semantic — Telegram ──
  {
    glob: "telegram/channel-profile.md",
    layer: "semantic",
    entity_type: "project",
    entity_name: "telegram-channel",
    importance: 0.7,
    confidence: 0.9,
    split: "h2",
  },

  // ── Episodic (P3) ──
  {
    glob: "journal/2026-*.md",
    layer: "episodic",
    entity_type: "user",
    entity_name: "nikita",
    importance: 0.6,
    confidence: 0.9,
    split: "h2",
    fileFilter: (f) => /^2026-\d{2}-\d{2}\.md$/.test(f),
  },
  {
    glob: "journal/2025-q*.md",
    layer: "episodic",
    entity_type: "user",
    entity_name: "nikita",
    importance: 0.6,
    confidence: 0.8,
    split: "h2",
  },
  {
    glob: "journal/2024-q*.md",
    layer: "episodic",
    entity_type: "user",
    entity_name: "nikita",
    importance: 0.5,
    confidence: 0.8,
    split: "h2",
  },
  {
    glob: "journal/2024.md",
    layer: "episodic",
    entity_type: "user",
    entity_name: "nikita",
    importance: 0.5,
    confidence: 0.8,
    split: "h2",
  },

  // ── Ideas & Creative (P4) ──
  {
    glob: "ideas/ideas.md",
    layer: "semantic",
    entity_type: "concept",
    entity_name: "from-heading",
    importance: 0.5,
    confidence: 0.8,
    split: "h2",
  },
  {
    glob: "ideas/content-ideas.md",
    layer: "semantic",
    entity_type: "concept",
    entity_name: "from-heading",
    importance: 0.5,
    confidence: 0.8,
    split: "h2",
  },
  {
    glob: "ideas/watch-later.md",
    layer: "resource",
    entity_type: "concept",
    importance: 0.3,
    confidence: 0.8,
    split: "whole",
  },
  {
    glob: "creative/rap.md",
    layer: "resource",
    entity_type: "user",
    entity_name: "nikita",
    importance: 0.4,
    confidence: 0.8,
    split: "h2",
  },
  {
    glob: "creative/standup.md",
    layer: "resource",
    entity_type: "user",
    entity_name: "nikita",
    importance: 0.4,
    confidence: 0.8,
    split: "h2",
  },
  {
    glob: "creative/writing.md",
    layer: "resource",
    entity_type: "user",
    entity_name: "nikita",
    importance: 0.4,
    confidence: 0.8,
    split: "h2",
  },
  {
    glob: "creative/jokes.md",
    layer: "resource",
    entity_type: "user",
    entity_name: "nikita",
    importance: 0.4,
    confidence: 0.8,
    split: "h2",
  },
];

/** External files (outside KB root) to import */
export const EXTERNAL_FILES: Array<{
  path: string;
  mapping: FileMapping;
}> = [
  // ~/.claude/CLAUDE.md removed: procedural rules belong in CLAUDE.md context,
  // not in FTS5 search — they pollute results for factual/episodic queries
];

/** Files/patterns to explicitly skip */
export const SKIP_PATTERNS = [
  // nutrition/ — only targets.md imported (via DIRECTORY_MAPPINGS)
  "nutrition/2*.md",
  "nutrition/*.json",
  // habits/ — only streaks.md imported (via DIRECTORY_MAPPINGS)
  "habits/2*.md",
  "habits/week-*.md",
  // telegram/ — only channel-profile.md imported (via DIRECTORY_MAPPINGS)
  "telegram/posts.md",
  "telegram/prepared-posts.md",
  "telegram/scheduled.md",
  "telegram/post-ideas.md",
  "telegram/content-ideas.md",
  "language/**",
  "tasks/**",
  "meta/**",
  "eval/**",
  "ai-tools/**",
  "tmp/**",
  "email/**",
  "finance/**",
  "content/**",
  "personal/**",
  "reference/**",
];
