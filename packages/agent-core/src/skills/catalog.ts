import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { SKILLS_ROOT, loadRawSkillFile } from "./loader.js";
import type { SkillDefinition, SkillRequirements } from "./types.js";

export const MAX_DYNAMIC_SKILLS = 24;

interface SkillCatalogCache {
  readonly signature: string;
  readonly skills: readonly SkillDefinition[];
}

let catalogCache: SkillCatalogCache | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toStringValue = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toBooleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
};

const toNumberValue = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toStringArray = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return [];
    }
    return trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
};

const getSkillMetaSource = (
  metadata: Record<string, unknown>,
): Record<string, unknown> => {
  const namespace = metadata.helmsman;
  if (isRecord(namespace)) {
    return {
      ...metadata,
      ...namespace,
    };
  }
  return metadata;
};

const describeFromBody = (body: string): string | undefined => {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  return lines[0];
};

const buildRequirements = (
  meta: Record<string, unknown>,
): SkillRequirements | undefined => {
  const requiresRaw = meta.requires;
  if (!isRecord(requiresRaw)) {
    return undefined;
  }

  const env = toStringArray(requiresRaw.env);
  const bins = toStringArray(requiresRaw.bins);

  if (env.length === 0 && bins.length === 0) {
    return undefined;
  }

  return {
    ...(bins.length > 0 ? { bins } : {}),
    ...(env.length > 0 ? { env } : {}),
  };
};

const createSkillDefinition = (skillPath: string): SkillDefinition | null => {
  try {
    const parsed = loadRawSkillFile(skillPath);
    const meta = getSkillMetaSource(parsed.metadata);

    const name =
      toStringValue(meta.name) ??
      toStringValue(parsed.metadata.name) ??
      skillPath;
    const id = toStringValue(meta.id) ?? name;
    const description =
      toStringValue(meta.description) ??
      toStringValue(parsed.metadata.description) ??
      describeFromBody(parsed.body) ??
      `Skill loaded from ${skillPath}`;

    const alwaysOn =
      toBooleanValue(meta.alwaysOn) ?? toBooleanValue(meta.always) ?? false;

    const priority = toNumberValue(meta.priority) ?? (alwaysOn ? 100 : 50);

    const keywords = toStringArray(meta.keywords);
    const requires = buildRequirements(meta);

    return {
      id,
      name,
      description,
      skillPath,
      keywords,
      priority,
      alwaysOn,
      requires,
    };
  } catch {
    return null;
  }
};

const listSkillPaths = (): readonly string[] => {
  if (!existsSync(SKILLS_ROOT)) {
    return [];
  }

  return readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((dirName) => existsSync(join(SKILLS_ROOT, dirName, "SKILL.md")))
    .sort((a, b) => a.localeCompare(b));
};

const buildCatalogSnapshot = (): SkillCatalogCache => {
  const skillPaths = listSkillPaths();
  const fingerprint = skillPaths
    .map((skillPath) => {
      const filePath = join(SKILLS_ROOT, skillPath, "SKILL.md");
      const stats = statSync(filePath);
      return `${skillPath}:${stats.mtimeMs}:${stats.size}`;
    })
    .join("|");

  if (catalogCache && catalogCache.signature === fingerprint) {
    return catalogCache;
  }

  const discovered = skillPaths
    .map((skillPath) => createSkillDefinition(skillPath))
    .filter((skill): skill is SkillDefinition => skill !== null)
    .sort((a, b) => {
      if (a.alwaysOn !== b.alwaysOn) {
        return a.alwaysOn ? -1 : 1;
      }
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.name.localeCompare(b.name);
    });

  const snapshot: SkillCatalogCache = {
    signature: fingerprint,
    skills: discovered,
  };

  catalogCache = snapshot;
  return snapshot;
};

export function getSkillCatalog(): readonly SkillDefinition[] {
  return buildCatalogSnapshot().skills;
}
