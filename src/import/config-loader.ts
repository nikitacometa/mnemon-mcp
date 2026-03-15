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
import { z } from "zod";
import type { DirectoryMapping, FileMapping } from "./kb-config.js";

// ── JSON config schema (Zod-validated) ──

const LayerEnum = z.enum(["episodic", "semantic", "procedural", "resource"]);
const EntityTypeEnum = z.enum(["user", "project", "person", "concept", "file", "rule", "tool"]);
const SplitEnum = z.enum(["whole", "h2", "h3"]);

const ConfigMappingSchema = z.object({
  glob: z.string().min(1),
  layer: LayerEnum,
  entity_type: EntityTypeEnum,
  entity_name: z.string().optional(),
  importance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  split: SplitEnum,
  file_pattern: z.string().optional(),
  scope: z.string().optional(),
});

const ConfigExternalFileSchema = z.object({
  path: z.string().min(1),
  mapping: z.object({
    layer: LayerEnum,
    entity_type: EntityTypeEnum,
    entity_name: z.string().optional(),
    importance: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    split: SplitEnum,
    scope: z.string().optional(),
  }),
});

const ConfigJsonSchema = z.object({
  owner_name: z.string().optional(),
  extra_stop_words: z.array(z.string()).optional(),
  mappings: z.array(ConfigMappingSchema),
  external_files: z.array(ConfigExternalFileSchema).optional(),
});

type ConfigJson = z.infer<typeof ConfigJsonSchema>;

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
    const parsed: unknown = JSON.parse(raw);
    json = ConfigJsonSchema.parse(parsed);
  } catch (err) {
    throw new Error(`Invalid config at ${resolvedPath}: ${err}`);
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
