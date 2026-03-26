import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LoadedSkillDoc } from "./types.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const SKILLS_ROOT = resolve(MODULE_DIR, "../../../../skills");
const skillDocCache = new Map<string, LoadedSkillDoc>();

const stripQuotes = (value: string): string => {
  return value.replace(/^"|"$/g, "").replace(/^'|'$/g, "").trim();
};

const parseScalarValue = (raw: string): unknown => {
  const value = raw.trim();
  if (value.length === 0) {
    return "";
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return stripQuotes(value);
  }

  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner.length === 0) {
      return [];
    }
    return inner
      .split(",")
      .map((part) => parseScalarValue(part));
  }

  return value;
};

const countIndent = (line: string): number => {
  let indent = 0;
  while (indent < line.length && line[indent] === " ") {
    indent += 1;
  }
  return indent;
};

const parseFrontmatter = (
  raw: string,
): { metadata: Record<string, unknown>; body: string } => {
  const normalizedRaw = raw.replace(/\r\n/g, "\n");
  const match = normalizedRaw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { metadata: {}, body: normalizedRaw.trim() };
  }

  const [, frontmatter = "", body = ""] = match;
  const lines = frontmatter.split("\n");
  const metadata: Record<string, unknown> = {};
  const stack: Array<{ indent: number; value: Record<string, unknown> | unknown[] }> = [
    { indent: -1, value: metadata },
  ];

  const getNextContentLine = (start: number): string | null => {
    for (let i = start; i < lines.length; i += 1) {
      const candidate = lines[i]?.trim() ?? "";
      if (candidate.length === 0 || candidate.startsWith("#")) {
        continue;
      }
      return candidate;
    }
    return null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const indent = countIndent(line);
    while (stack.length > 1 && indent <= (stack[stack.length - 1]?.indent ?? -1)) {
      stack.pop();
    }

    const current = stack[stack.length - 1]?.value;
    if (!current) {
      continue;
    }

    if (trimmed.startsWith("- ")) {
      if (!Array.isArray(current)) {
        continue;
      }
      const item = trimmed.slice(2).trim();
      current.push(parseScalarValue(item));
      continue;
    }

    const separator = trimmed.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (key.length === 0 || Array.isArray(current)) {
      continue;
    }

    if (rawValue.length > 0) {
      current[key] = parseScalarValue(rawValue);
      continue;
    }

    const nextLine = getNextContentLine(i + 1);
    const container: Record<string, unknown> | unknown[] =
      nextLine?.startsWith("- ") ? [] : {};
    current[key] = container;
    stack.push({ indent, value: container });
  }

  return {
    metadata,
    body: body.trim(),
  };
};

export function loadSkillDoc(skillPath: string): LoadedSkillDoc {
  const fullPath = join(SKILLS_ROOT, skillPath, "SKILL.md");
  const cached = skillDocCache.get(fullPath);
  if (cached) {
    return cached;
  }

  const raw = readFileSync(fullPath, "utf8");
  const parsed = parseFrontmatter(raw);
  const metadataName =
    typeof parsed.metadata.name === "string" ? parsed.metadata.name : "";
  const metadataDescription =
    typeof parsed.metadata.description === "string"
      ? parsed.metadata.description
      : "";
  const document: LoadedSkillDoc = {
    name: metadataName || skillPath,
    description: metadataDescription,
    body: parsed.body,
    sourcePath: fullPath,
  };

  skillDocCache.set(fullPath, document);
  return document;
}

export function tryLoadSkillDoc(skillPath: string): LoadedSkillDoc | null {
  try {
    return loadSkillDoc(skillPath);
  } catch {
    return null;
  }
}

export function loadRawSkillFile(skillPath: string): {
  readonly metadata: Record<string, unknown>;
  readonly body: string;
  readonly sourcePath: string;
} {
  const fullPath = join(SKILLS_ROOT, skillPath, "SKILL.md");
  const raw = readFileSync(fullPath, "utf8");
  const parsed = parseFrontmatter(raw);

  return {
    metadata: parsed.metadata,
    body: parsed.body,
    sourcePath: fullPath,
  };
}
