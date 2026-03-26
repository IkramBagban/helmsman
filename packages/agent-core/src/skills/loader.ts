import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LoadedSkillDoc } from "./types.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = resolve(MODULE_DIR, "../../../../skills");
const skillDocCache = new Map<string, LoadedSkillDoc>();

const stripQuotes = (value: string): string => {
  return value.replace(/^"|"$/g, "").replace(/^'|'$/g, "").trim();
};

const parseFrontmatter = (
  raw: string,
): { metadata: Record<string, string>; body: string } => {
  const normalizedRaw = raw.replace(/\r\n/g, "\n");
  const match = normalizedRaw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { metadata: {}, body: normalizedRaw.trim() };
  }

  const [, frontmatter = "", body = ""] = match;
  const metadataLines = frontmatter.split("\n");
  const metadata: Record<string, string> = {};
  for (const line of metadataLines) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key) {
      continue;
    }

    metadata[key] = stripQuotes(value);
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
  const document: LoadedSkillDoc = {
    name: parsed.metadata.name || skillPath,
    description: parsed.metadata.description || "",
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
