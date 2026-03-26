import { spawnSync } from "node:child_process";

import { MAX_DYNAMIC_SKILLS, SKILL_CATALOG } from "./catalog.js";
import type {
  SelectedSkill,
  SkillDefinition,
  SkillEligibility,
} from "./types.js";

const MAX_FALLBACK_DYNAMIC_SKILLS = 1;

const binaryAvailabilityCache = new Map<string, boolean>();

interface SkillScore {
  readonly score: number;
  readonly matchCount: number;
}

interface ScoredSkill {
  readonly skill: SkillDefinition;
  readonly score: number;
  readonly matchCount: number;
  readonly eligibility: SkillEligibility;
}

const tokenize = (text: string): readonly string[] => {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((part) => part.length > 0);
};

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

const scoreSkill = (
  skill: SkillDefinition,
  tokens: readonly string[],
): SkillScore => {
  if (skill.alwaysOn) {
    return {
      score: Number.POSITIVE_INFINITY,
      matchCount: Number.POSITIVE_INFINITY,
    };
  }

  let score = skill.priority;
  let matchCount = 0;
  const tokenSet = new Set(tokens);
  const joined = tokens.join(" ");

  for (const keyword of skill.keywords) {
    const normalizedKeyword = keyword.toLowerCase();
    if (normalizedKeyword.includes(" ")) {
      if (joined.includes(normalizedKeyword)) {
        score += 12;
        matchCount += 1;
      }
      continue;
    }

    if (tokenSet.has(normalizedKeyword)) {
      score += 10;
      matchCount += 1;
    }
  }

  return { score, matchCount };
};

const scoreCatalog = (userMessage: string): readonly ScoredSkill[] => {
  const tokens = tokenize(userMessage);

  return SKILL_CATALOG.map((skill) => {
    const eligibility = evaluateSkillEligibility(skill);
    const score = scoreSkill(skill, tokens);
    return {
      skill,
      score: score.score,
      matchCount: score.matchCount,
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

  const matchedDynamic = eligibleDynamic.filter((entry) => entry.matchCount > 0);
  const dynamicPool =
    matchedDynamic.length > 0
      ? matchedDynamic
      : eligibleDynamic.slice(0, MAX_FALLBACK_DYNAMIC_SKILLS);

  return dynamicPool.slice(0, MAX_DYNAMIC_SKILLS);
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
  recommendedIds: ReadonlySet<string>,
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
    `  <status>${eligibility.eligible ? "eligible" : "unavailable"}</status>`,
    `  <why>${reasons}</why>`,
    `  <recommended>${recommendedIds.has(skill.id) ? "true" : "false"}</recommended>`,
    "</skill>",
  ].join("\n");
};

export function selectSkillsForMessage(
  userMessage: string,
): readonly SelectedSkill[] {
  const scored = scoreCatalog(userMessage);

  const alwaysOnSkills = scored
    .filter((entry) => entry.skill.alwaysOn && entry.eligibility.eligible)
    .map((entry) => buildSelectedSkill(entry.skill, entry.score, entry.eligibility));

  const dynamicSkills = selectDynamicCandidates(scored)
    .map((entry) => buildSelectedSkill(entry.skill, entry.score, entry.eligibility));

  return [...alwaysOnSkills, ...dynamicSkills];
}

export function buildSkillContext(userMessage: string): string {
  const scored = scoreCatalog(userMessage);
  const alwaysOnEligible = scored
    .filter((entry) => entry.skill.alwaysOn && entry.eligibility.eligible)
    .map((entry) => entry.skill.id);
  const dynamicRecommended = selectDynamicCandidates(scored).map(
    (entry) => entry.skill.id,
  );

  const recommendedIds = new Set<string>([
    ...alwaysOnEligible,
    ...dynamicRecommended,
  ]);

  const catalog = scored
    .map((entry) => buildCatalogItem(entry, recommendedIds))
    .join("\n");

  const recommendedList = Array.from(recommendedIds)
    .map((id) => `- ${id}`)
    .join("\n");

  return [
    "## Skills (mandatory)",
    "Before replying: scan <available_skills> entries and decide relevance from descriptions.",
    "- If exactly one skill clearly applies: call `skill_read` for that skill, then follow it.",
    "- If multiple could apply: choose the most specific one, call `skill_read` for it first, then proceed.",
    "- If none clearly apply: do not call `skill_read`.",
    "Constraints: read at most one skill up front; only read additional skills if needed after first result.",
    "",
    "<available_skills>",
    catalog,
    "</available_skills>",
    "",
    "Selector recommendations (non-binding):",
    recommendedList.length > 0 ? recommendedList : "- none",
  ].join("\n");
}
