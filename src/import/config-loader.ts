/**
 * Config loader for KB import pipeline.
 * Reads directory mappings from a JSON config file instead of hardcoded TypeScript.
 *
 * Resolution order:
 *   1. --config CLI flag
 *   2. MNEMON_CONFIG_PATH env var
 *   3. ~/.mnemon-mcp/config.json
 *
 * If no config found, returns empty mappings with a helpful message to stderr.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DirectoryMapping, FileMapping } from "./kb-config.js";
import type { EntityType, Layer } from "../types.js";

// ── JSON config schema ──

export interface ConfigJson {
  /** Name of the KB owner — used as entity_name where mappings specify "$owner" */
  owner_name?: string;
  /** Additional stop words to filter from search queries (e.g. owner name forms) */
  extra_stop_words?: string[];
  /** Directory-to-layer mappings */
  mappings: ConfigMapping[];
  /** Files outside the KB root to import */
  external_files?: ConfigExternalFile[];
}

interface ConfigMapping {
  glob: string;
  layer: Layer;
  entity_type: EntityType;
  /** Literal name, "from-heading", or "$owner" (replaced with owner_name) */
  entity_name?: string;
  importance: number;
  confidence: number;
  split: "whole" | "h2" | "h3";
  /** Regex pattern to filter filenames (replaces fileFilter function) */
  file_pattern?: string;
  scope?: string;
}

interface ConfigExternalFile {
  path: string;
  mapping: {
    layer: Layer;
    entity_type: EntityType;
    entity_name?: string;
    importance: number;
    confidence: number;
    split: "whole" | "h2" | "h3";
    scope?: string;
  };
}

// ── Default config path ──

const DEFAULT_CONFIG_PATH = join(homedir(), ".mnemon-mcp", "config.json");

// ── Loader ──

export interface LoadedConfig {
  mappings: DirectoryMapping[];
  externalFiles: Array<{ path: string; mapping: FileMapping }>;
  ownerName?: string | undefined;
  extraStopWords: string[];
}

/**
 * Load config from JSON file. Returns empty config if file not found.
 * @param configPath - explicit path to config file (overrides default)
 */
export function loadConfig(configPath?: string): LoadedConfig {
  const resolvedPath =
    configPath ??
    process.env["MNEMON_CONFIG_PATH"] ??
    DEFAULT_CONFIG_PATH;

  if (!existsSync(resolvedPath)) {
    if (!configPath && !process.env["MNEMON_CONFIG_PATH"]) {
      // Default path not found — first run, guide the user
      console.error(
        `[mnemon] No config found at ${resolvedPath}\n` +
          `  Create one from the example: cp config.example.json ~/.mnemon-mcp/config.json\n` +
          `  Or specify: --config <path> or MNEMON_CONFIG_PATH env var\n` +
          `  Running with empty mappings (no files will be imported).`
      );
    } else {
      console.error(`[mnemon] Config file not found: ${resolvedPath}`);
    }
    return { mappings: [], externalFiles: [], extraStopWords: [] };
  }

  let raw: string;
  try {
    raw = readFileSync(resolvedPath, "utf8");
  } catch (err) {
    throw new Error(`Failed to read config: ${resolvedPath}: ${err}`);
  }

  let json: ConfigJson;
  try {
    json = JSON.parse(raw) as ConfigJson;
  } catch (err) {
    throw new Error(`Invalid JSON in config: ${resolvedPath}: ${err}`);
  }

  return parseConfig(json);
}

/** Convert JSON config into runtime DirectoryMapping[] */
function parseConfig(json: ConfigJson): LoadedConfig {
  const ownerName = json.owner_name;

  const mappings: DirectoryMapping[] = json.mappings.map((m) => {
    let entityName = m.entity_name;
    if (entityName === "$owner") {
      entityName = ownerName;
    }

    const mapping: DirectoryMapping = {
      glob: m.glob,
      layer: m.layer,
      entity_type: m.entity_type,
      importance: m.importance,
      confidence: m.confidence,
      split: m.split,
      ...(entityName ? { entity_name: entityName } : {}),
      ...(m.scope ? { scope: m.scope } : {}),
    };

    // Convert regex string to filter function
    if (m.file_pattern) {
      const regex = new RegExp(m.file_pattern);
      mapping.fileFilter = (filename: string) => regex.test(filename);
    }

    return mapping;
  });

  const externalFiles = (json.external_files ?? []).map((ext) => {
    let entityName = ext.mapping.entity_name;
    if (entityName === "$owner") {
      entityName = ownerName;
    }

    return {
      path: ext.path,
      mapping: {
        layer: ext.mapping.layer,
        entity_type: ext.mapping.entity_type,
        importance: ext.mapping.importance,
        confidence: ext.mapping.confidence,
        split: ext.mapping.split,
        ...(entityName ? { entity_name: entityName } : {}),
        ...(ext.mapping.scope ? { scope: ext.mapping.scope } : {}),
      } as FileMapping,
    };
  });

  return {
    mappings,
    externalFiles,
    ownerName,
    extraStopWords: json.extra_stop_words ?? [],
  };
}

export { DEFAULT_CONFIG_PATH };
