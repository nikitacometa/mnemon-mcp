#!/usr/bin/env node
/**
 * CLI entry point for KB import pipeline.
 *
 * Usage:
 *   tsx src/import/cli.ts --kb-path ~/dev/mnemon-kb
 *   tsx src/import/cli.ts --file ~/dev/mnemon-kb/beliefs/worldview.md --layer semantic
 *   tsx src/import/cli.ts --kb-path ~/dev/mnemon-kb --dry-run
 *   tsx src/import/cli.ts --kb-path ~/dev/mnemon-kb --verbose
 */

import { runImport, type ImportResult } from "./kb-import.js";
import type { Layer } from "../types.js";

function parseArgs(args: string[]): {
  kbPath?: string | undefined;
  file?: string | undefined;
  layer?: Layer | undefined;
  dryRun: boolean;
  verbose: boolean;
} {
  const result: { kbPath?: string | undefined; file?: string | undefined; layer?: Layer | undefined; dryRun: boolean; verbose: boolean } = { dryRun: false, verbose: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--kb-path":
        result.kbPath = next;
        i++;
        break;
      case "--file":
        result.file = next;
        i++;
        break;
      case "--layer":
        result.layer = next as Layer;
        i++;
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
      case "--verbose":
      case "-v":
        result.verbose = true;
        break;
    }
  }

  return result;
}

function printSummary(result: ImportResult, dryRun: boolean): void {
  const prefix = dryRun ? "[DRY RUN] " : "";

  console.log(`\n${prefix}═══ Import Summary ═══`);
  console.log(`Files processed:    ${result.filesProcessed}`);
  console.log(`Files skipped:      ${result.filesSkipped} (unchanged)`);
  console.log(`Memories created:   ${result.memoriesCreated}`);
  console.log(`Memories superseded: ${result.memoriesSuperseded}`);

  if (result.errors.length > 0) {
    console.log(`\nErrors (${result.errors.length}):`);
    for (const err of result.errors) {
      console.log(`  ✗ ${err.file}: ${err.error}`);
    }
  }

  // Detail table
  const imported = result.details.filter((d) => d.status === "imported");
  const updated = result.details.filter((d) => d.status === "updated");
  const skipped = result.details.filter((d) => d.status === "skipped");

  if (imported.length > 0) {
    console.log(`\nImported (${imported.length}):`);
    for (const d of imported) {
      console.log(`  + ${d.file} (${d.sections} sections)`);
    }
  }

  if (updated.length > 0) {
    console.log(`\nUpdated (${updated.length}):`);
    for (const d of updated) {
      console.log(`  ~ ${d.file} (${d.sections} sections)`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\nSkipped (${skipped.length}): ${skipped.map((d) => d.file).join(", ")}`);
  }
}

// ── Main ──

const args = parseArgs(process.argv.slice(2));

if (!args.kbPath && !args.file) {
  console.error("Usage: tsx src/import/cli.ts --kb-path <path> [--dry-run] [--verbose]");
  console.error("       tsx src/import/cli.ts --file <path> --layer <layer>");
  process.exit(1);
}

try {
  const result = runImport({
    kbPath: args.kbPath ?? ".",
    singleFile: args.file,
    singleLayer: args.layer,
    dryRun: args.dryRun,
    verbose: args.verbose,
  });
  printSummary(result, args.dryRun);
  process.exit(result.errors.length > 0 ? 1 : 0);
} catch (err) {
  console.error(`Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
