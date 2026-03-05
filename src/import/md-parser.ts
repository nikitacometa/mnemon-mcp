/**
 * Markdown parser — frontmatter extraction, heading-based splitting, hashing.
 */

import { createHash } from "node:crypto";

export interface Frontmatter {
  [key: string]: unknown;
  layer?: string;
  last_updated?: string;
  description?: string;
  tags?: string[];
  importance?: number;
}

export interface Section {
  title: string;
  level: number;
  content: string;
}

export interface ParsedFile {
  frontmatter: Frontmatter;
  body: string;
  hash: string;
}

/** Parse YAML frontmatter delimited by --- */
export function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }

  const yamlBlock = match[1]!;
  const body = match[2]!;
  const frontmatter: Frontmatter = {};

  for (const line of yamlBlock.split("\n")) {
    const kv = line.match(/^(\w[\w_-]*)\s*:\s*(.+)$/);
    if (!kv) continue;

    const key = kv[1]!;
    let value: unknown = kv[2]!.trim();

    // Parse arrays: [a, b, c]
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim());
    }
    // Parse numbers
    else if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) {
      value = parseFloat(value);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/** Split markdown by heading level (H2 or H3) into sections */
export function splitByHeading(body: string, level: 2 | 3): Section[] {
  const prefix = "#".repeat(level) + " ";
  const lines = body.split("\n");
  const sections: Section[] = [];

  let currentTitle = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(prefix)) {
      // Save previous section (skip prelude content before first heading)
      if (currentTitle) {
        const content = currentLines.join("\n").trim();
        if (content) {
          sections.push({ title: currentTitle, level, content });
        }
      }
      currentTitle = line.slice(prefix.length).trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Last section (skip if no heading was encountered)
  if (currentTitle) {
    const content = currentLines.join("\n").trim();
    if (content) {
      sections.push({ title: currentTitle, level, content });
    }
  }

  return sections;
}

/** Extract date from filename like 2026-03-05.md → ISO string */
export function extractDateFromFilename(filename: string): string | null {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  return `${match[1]}T00:00:00Z`;
}

/** Compute SHA-256 hash of content */
export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Full parse: frontmatter + body + hash */
export function parseFile(raw: string): ParsedFile {
  const { frontmatter, body } = parseFrontmatter(raw);
  const hash = computeHash(raw);
  return { frontmatter, body, hash };
}
