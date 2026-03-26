import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { SKILL_CATALOG } from "../skills/catalog.js";
import { tryLoadSkillDoc } from "../skills/loader.js";
import { logTrace, previewText } from "../trace-logger.js";

const resolveSkillPath = (skill: string): string | null => {
  const needle = skill.trim().toLowerCase();
  if (needle.length === 0) {
    return null;
  }

  const matched = SKILL_CATALOG.find((entry) => {
    return (
      entry.id.toLowerCase() === needle ||
      entry.name.toLowerCase() === needle ||
      entry.skillPath.toLowerCase() === needle
    );
  });

  return matched?.skillPath ?? null;
};

export const skillReadTool = createTool({
  id: "skill_read",
  description:
    "Read a single local SKILL.md by skill id/name/path from the skill catalog. Use this after selecting the most relevant skill.",
  inputSchema: z.object({
    skill: z
      .string()
      .describe("Skill id, name, or skillPath from the available skill catalog"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    skill: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    body: z.string().optional(),
    sourcePath: z.string().optional(),
    error: z.string().optional(),
    availableSkills: z.array(z.string()).optional(),
  }),
  execute: async (inputData) => {
    const requestedSkill = inputData.skill;
    const startedAt = Date.now();

    logTrace("tool.skill_read.started", {
      skill: requestedSkill,
    });

    const resolvedPath = resolveSkillPath(requestedSkill);
    if (!resolvedPath) {
      const availableSkills = SKILL_CATALOG.map((entry) => entry.id);
      logTrace(
        "tool.skill_read.completed",
        {
          skill: requestedSkill,
          success: false,
          durationMs: Date.now() - startedAt,
          error: "Skill not found",
        },
        "warn",
      );
      return {
        success: false,
        skill: requestedSkill,
        error: "Skill not found in catalog.",
        availableSkills,
      };
    }

    const document = tryLoadSkillDoc(resolvedPath);
    if (!document) {
      logTrace(
        "tool.skill_read.completed",
        {
          skill: requestedSkill,
          resolvedPath,
          success: false,
          durationMs: Date.now() - startedAt,
          error: "Skill file could not be loaded",
        },
        "warn",
      );
      return {
        success: false,
        skill: requestedSkill,
        error: "Skill file could not be loaded.",
      };
    }

    logTrace("tool.skill_read.completed", {
      skill: requestedSkill,
      resolvedPath,
      success: true,
      durationMs: Date.now() - startedAt,
      bodyPreview: previewText(document.body),
      sourcePath: document.sourcePath,
    });

    return {
      success: true,
      skill: requestedSkill,
      name: document.name,
      description: document.description,
      body: document.body,
      sourcePath: document.sourcePath,
    };
  },
});
