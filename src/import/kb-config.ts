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

  // ── Procedural (P2) ──
  {
    glob: "workspace-snapshot/SOUL.md",
    layer: "procedural",
    entity_type: "rule",
    importance: 1.0,
    confidence: 1.0,
    split: "h2",
    scope: "euphoria",
  },
  {
    glob: "workspace-snapshot/IDENTITY.md",
    layer: "procedural",
    entity_type: "rule",
    importance: 0.9,
    confidence: 1.0,
    split: "h2",
    scope: "euphoria",
  },
  {
    glob: "workspace-snapshot/FORMATTING.md",
    layer: "procedural",
    entity_type: "rule",
    importance: 0.8,
    confidence: 1.0,
    split: "h2",
    scope: "euphoria",
  },
  {
    glob: "workspace-snapshot/USER.md",
    layer: "procedural",
    entity_type: "rule",
    importance: 0.9,
    confidence: 1.0,
    split: "h2",
    scope: "euphoria",
  },
  {
    glob: "workspace-snapshot/examples/*.md",
    layer: "procedural",
    entity_type: "rule",
    importance: 0.8,
    confidence: 1.0,
    split: "whole",
    scope: "euphoria",
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
  {
    path: "~/.claude/CLAUDE.md",
    mapping: {
      layer: "procedural",
      entity_type: "rule",
      importance: 1.0,
      confidence: 1.0,
      split: "h2",
      scope: "claude-code",
    },
  },
];

/** Files/patterns to explicitly skip */
export const SKIP_PATTERNS = [
  "nutrition/**",
  "habits/**",
  "telegram/posts.md",
  "language/**/*.json",
  "workspace-snapshot/skills/**",
  "workspace-snapshot/MEMORY.md",
  "workspace-snapshot/HEARTBEAT.md",
  "workspace-snapshot/AGENTS.md",
  "workspace-snapshot/TOOLS.md",
  "workspace-snapshot/FORMATTING-TEMPLATES.md",
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
