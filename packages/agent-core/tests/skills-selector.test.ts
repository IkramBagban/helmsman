import { describe, expect, it } from "bun:test";

import {
  buildSkillContext,
  MAX_DYNAMIC_SKILLS,
  selectSkillsForMessage,
} from "../src/skills/index.js";

describe("selectSkillsForMessage", () => {
  it("should always include the core truthfulness skill", () => {
    const selected = selectSkillsForMessage("hello there");
    expect(
      selected.some((entry) => entry.skill.id === "core-truthfulness"),
    ).toBe(true);
  });

  it("should keep only always-on skill when message is irrelevant", () => {
    const selected = selectSkillsForMessage("hi there");
    expect(selected.map((entry) => entry.skill.id)).toContain(
      "core-truthfulness",
    );
    expect(selected.length).toBeGreaterThanOrEqual(1);
  });

  it("should select the highest-priority relevant skills for mixed-domain requests", () => {
    const selected = selectSkillsForMessage(
      "schedule a daily AWS billing report and update DNS for api.example.com",
    );

    const selectedIds = selected.map((entry) => entry.skill.id);
    const dynamicSelectedIds = selectedIds.filter(
      (id) => id !== "core-truthfulness",
    );

    expect(selectedIds).toContain("aws-operations");
    expect(dynamicSelectedIds.length).toBe(MAX_DYNAMIC_SKILLS);
    expect(dynamicSelectedIds).toContain("scheduling");
    expect(dynamicSelectedIds).not.toContain("dns");
  });

  it("should cap dynamic skills to the configured maximum", () => {
    const selected = selectSkillsForMessage(
      "use aws and github and dns and schedule reminders and check cloudwatch",
    );

    const dynamicCount = selected.filter(
      (entry) => entry.skill.alwaysOn !== true,
    ).length;
    expect(dynamicCount).toBeLessThanOrEqual(MAX_DYNAMIC_SKILLS);
  });
});

describe("buildSkillContext", () => {
  it("should render a compact skill context section", () => {
    const context = buildSkillContext(
      "check AWS EC2 cost and set a reminder every day",
    );

    expect(context).toContain("## Skills (mandatory)");
    expect(context).toContain("<available_skills>");
    expect(context).toContain("<name>aws-operations</name>");
    expect(context).toContain("<name>scheduling</name>");
    expect(context).toContain("call `skill_read`");
    expect(context).not.toContain("## Workflow");
  });

  it("should return empty skill context when no dynamic skill matches", () => {
    const context = buildSkillContext("hi");
    expect(context).toBe("");
  });

  it("should include only matching dynamic skills in the catalog", () => {
    const context = buildSkillContext("list all my ec2 instances");

    expect(context).toContain("<name>aws-operations</name>");
    expect(context).toContain("<always>false</always>");
    expect(context).not.toContain("<name>scheduling</name>");
    expect(context).not.toContain("<name>dns</name>");
    expect(context).not.toContain("<name>core-truthfulness</name>");
  });
});
