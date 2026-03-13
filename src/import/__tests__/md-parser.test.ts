import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  splitByHeading,
  extractDateFromFilename,
  computeHash,
} from "../md-parser.js";

describe("parseFrontmatter", () => {
  it("extracts key-value pairs from YAML frontmatter", () => {
    const raw = `---
last_updated: 2026-03-05
description: Test file
tags: [a, b, c]
importance: 0.8
---
# Body content`;

    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.last_updated).toBe("2026-03-05");
    expect(frontmatter.description).toBe("Test file");
    expect(frontmatter.tags).toEqual(["a", "b", "c"]);
    expect(frontmatter.importance).toBe(0.8);
    expect(body).toBe("# Body content");
  });

  it("returns empty frontmatter when no --- delimiters", () => {
    const raw = "# Just a heading\nSome content";
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });

  it("handles frontmatter with layer field", () => {
    const raw = `---
layer: episodic
---
Content`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.layer).toBe("episodic");
  });

  it("handles colons in frontmatter values", () => {
    const raw = `---
description: Book: The Art of War
url: https://example.com/path
---
Content`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter["description"]).toBe("Book: The Art of War");
    expect(frontmatter["url"]).toBe("https://example.com/path");
  });

  it("strips surrounding quotes from frontmatter values", () => {
    const raw = `---
title: "A title with: colons"
note: 'single quoted value'
---
Content`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter["title"]).toBe("A title with: colons");
    expect(frontmatter["note"]).toBe("single quoted value");
  });

  it("preserves quoted numeric strings without coercing to number", () => {
    const raw = `---
version: "0012"
id: "1.0"
plain_num: 42
---
Content`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter["version"]).toBe("0012");
    expect(frontmatter["id"]).toBe("1.0");
    expect(frontmatter["plain_num"]).toBe(42);
  });
});

describe("splitByHeading", () => {
  it("splits by H2 headings", () => {
    const body = `## First Section
Content A

## Second Section
Content B`;

    const sections = splitByHeading(body, 2);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.title).toBe("First Section");
    expect(sections[0]!.content).toBe("Content A");
    expect(sections[1]!.title).toBe("Second Section");
    expect(sections[1]!.content).toBe("Content B");
  });

  it("splits by H3 headings", () => {
    const body = `### Person A
Info about A

### Person B
Info about B`;

    const sections = splitByHeading(body, 3);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.title).toBe("Person A");
    expect(sections[1]!.title).toBe("Person B");
  });

  it("filters out prelude content before first heading (empty-title fix)", () => {
    const body = `Some intro text before any heading.

## Actual Section
Real content here`;

    const sections = splitByHeading(body, 2);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.title).toBe("Actual Section");
    expect(sections[0]!.content).toBe("Real content here");
  });

  it("filters trailing content without heading (empty-title fix)", () => {
    const body = "Just some text without any headings";
    const sections = splitByHeading(body, 2);
    expect(sections).toHaveLength(0);
  });

  it("skips sections with empty content", () => {
    const body = `## Has Content
Some text

## Empty Section

## Another With Content
More text`;

    const sections = splitByHeading(body, 2);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.title).toBe("Has Content");
    expect(sections[1]!.title).toBe("Another With Content");
  });

  it("does not treat H3 as H2 split point", () => {
    const body = `## Main
### Sub
Content under sub`;

    const sections = splitByHeading(body, 2);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.title).toBe("Main");
    expect(sections[0]!.content).toContain("### Sub");
  });
});

describe("extractDateFromFilename", () => {
  it("extracts ISO date from filename", () => {
    expect(extractDateFromFilename("2026-03-05.md")).toBe("2026-03-05T00:00:00Z");
  });

  it("extracts date from complex filename", () => {
    expect(extractDateFromFilename("journal-2025-12-31-notes.md")).toBe("2025-12-31T00:00:00Z");
  });

  it("returns null for filename without date", () => {
    expect(extractDateFromFilename("worldview.md")).toBeNull();
  });
});

describe("computeHash", () => {
  it("returns consistent SHA-256 hex digest", () => {
    const hash = computeHash("hello world");
    expect(hash).toHaveLength(64);
    expect(hash).toBe(computeHash("hello world"));
  });

  it("produces different hashes for different content", () => {
    expect(computeHash("a")).not.toBe(computeHash("b"));
  });
});
