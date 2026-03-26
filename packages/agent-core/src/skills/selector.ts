import { spawnSync } from "node:child_process";

import { MAX_DYNAMIC_SKILLS, getSkillCatalog } from "./catalog.js";
import type {
  SelectedSkill,
  SkillDefinition,
  SkillEligibility,
} from "./types.js";

const binaryAvailabilityCache = new Map<string, boolean>();

interface ScoredSkill {
  readonly skill: SkillDefinition;
  readonly score: number;
  readonly eligibility: SkillEligibility;
}
const MAX_SKILL_CATALOG_CHARS = 8_000;
const LOW_INTENT_MESSAGES = new Set([
  "hi",
  "hello",
  "hey",
  "yo",
  "sup",
  "thanks",
  "thank you",
  "ok",
  "okay",
  "cool",
  "great",
  "good morning",
  "good afternoon",
  "good evening",
]);

const hasBinary = (binary: string): boolean => {
  const cached = binaryAvailabilityCache.get(binary);
  if (cached !== undefined) {
    return cached;
  }

  const probeCommand = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probeCommand, [binary], {
    stdio: "ignore",
    shell: false,
  });
  const available = result.status === 0;
  binaryAvailabilityCache.set(binary, available);
  return available;
};

const evaluateSkillEligibility = (skill: SkillDefinition): SkillEligibility => {
  const missingBins = (skill.requires?.bins ?? []).filter((binary) => {
    return !hasBinary(binary);
  });
  const missingEnv = (skill.requires?.env ?? []).filter((envName) => {
    const rawValue = process.env[envName];
    return typeof rawValue !== "string" || rawValue.trim().length === 0;
  });

  return {
    eligible: missingBins.length === 0 && missingEnv.length === 0,
    missingBins,
    missingEnv,
  };
};

const isLikelyLowIntentMessage = (userMessage: string): boolean => {
  const normalized = userMessage
    .trim()
    .toLowerCase()
    .replace(/[!?.,]+/g, "");
  if (LOW_INTENT_MESSAGES.has(normalized)) {
    return true;
  }

  const parts = normalized.split(/\s+/g).filter((part) => part.length > 0);
  if (parts.length <= 3 && parts.every((part) => LOW_INTENT_MESSAGES.has(part) || part === "there")) {
    return true;
  }

  return false;
};

const scoreCatalog = (userMessage: string): readonly ScoredSkill[] => {
  const lowIntent = isLikelyLowIntentMessage(userMessage);
  const catalog = getSkillCatalog();
  return catalog.map((skill) => {
    const eligibility = evaluateSkillEligibility(skill);
    const score = lowIntent ? skill.priority - 1000 : skill.priority;
    return {
      skill,
      score,
      eligibility,
    };
  });
};

const selectDynamicCandidates = (
  scored: readonly ScoredSkill[],
): readonly ScoredSkill[] => {
  const eligibleDynamic = scored
    .filter((entry) => !entry.skill.alwaysOn && entry.eligibility.eligible)
    .sort((a, b) => b.score - a.score);

  return eligibleDynamic.slice(0, MAX_DYNAMIC_SKILLS);
};

const buildSelectedSkill = (
  skill: SkillDefinition,
  score: number,
  eligibility: SkillEligibility,
): SelectedSkill => {
  return {
    skill,
    score,
    eligibility,
    document: {
      name: skill.name,
      description: skill.description,
      body: "",
      sourcePath: `skills/${skill.skillPath}/SKILL.md`,
    },
  };
};

const buildCatalogItem = (
  entry: ScoredSkill,
): string => {
  const { skill, eligibility } = entry;
  const location = `skills/${skill.skillPath}/SKILL.md`;
  const reasonParts: string[] = [];

  if (eligibility.missingBins.length > 0) {
    reasonParts.push(`missing bins: ${eligibility.missingBins.join(", ")}`);
  }
  if (eligibility.missingEnv.length > 0) {
    reasonParts.push(`missing env: ${eligibility.missingEnv.join(", ")}`);
  }

  const reasons = reasonParts.length > 0 ? reasonParts.join("; ") : "ready";

  return [
    "<skill>",
    `  <name>${skill.name}</name>`,
    `  <description>${skill.description}</description>`,
    `  <location>${location}</location>`,
    `  <always>${skill.alwaysOn === true ? "true" : "false"}</always>`,
    `  <status>${eligibility.eligible ? "eligible" : "unavailable"}</status>`,
    `  <why>${reasons}</why>`,
    "</skill>",
  ].join("\n");
};

const buildCatalogWithBudget = (
  shortlisted: readonly ScoredSkill[],
): { readonly catalog: string; readonly omitted: number } => {
  const items: string[] = [];
  let totalChars = 0;
  for (const entry of shortlisted) {
    const item = buildCatalogItem(entry);
    const nextLength = totalChars + item.length + 1;
    if (nextLength > MAX_SKILL_CATALOG_CHARS) {
      const omitted = shortlisted.length - items.length;
      return {
        catalog: items.join("\n"),
        omitted,
      };
    }
    items.push(item);
    totalChars = nextLength;
  }

  return {
    catalog: items.join("\n"),
    omitted: 0,
  };
};

export function selectSkillsForMessage(
  userMessage: string,
): readonly SelectedSkill[] {
  const scored = scoreCatalog(userMessage);
  const lowIntent = isLikelyLowIntentMessage(userMessage);

  const alwaysOnSkills = scored
    .filter((entry) => entry.skill.alwaysOn && entry.eligibility.eligible)
    .map((entry) => buildSelectedSkill(entry.skill, entry.score, entry.eligibility));

  const dynamicSkills = lowIntent
    ? []
    : selectDynamicCandidates(scored)
        .map((entry) => buildSelectedSkill(entry.skill, entry.score, entry.eligibility));

  return [...alwaysOnSkills, ...dynamicSkills];
}

export function buildSkillContext(userMessage: string): string {
  if (isLikelyLowIntentMessage(userMessage)) {
    return "";
  }

  const scored = scoreCatalog(userMessage);
  const shortlisted = selectDynamicCandidates(scored);
  if (shortlisted.length === 0) {
    return "";
  }

  const { catalog, omitted } = buildCatalogWithBudget(shortlisted);

  if (catalog.length === 0) {
    return "";
  }

  return [
    "## Skills (mandatory)",
    "Before acting: this catalog contains environment-eligible skills (name/description/location only).",
    "- You MUST choose one catalog skill and call `skill_read` before any non-skill tool.",
    "- Select the most relevant skill for the current request.",
    "- Read at most one skill up front; read additional skills only if the first is insufficient.",
    omitted > 0
      ? `- Catalog truncated for token budget: ${omitted} additional eligible skill(s) omitted.`
      : "",
    "",
    "<available_skills>",
    catalog,
    "</available_skills>",
  ].join("\n");
}
