import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

interface AgentSoulData {
  readonly path: string | null;
  readonly content: string;
}

const findSoulPath = (startDir: string): string | null => {
  let current = resolve(startDir);

  while (true) {
    const candidate = join(current, "SOUL.md");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
};

const loadAgentSoul = (): AgentSoulData => {
  const path = findSoulPath(process.cwd());
  if (!path) {
    return { path: null, content: "" };
  }

  try {
    return { path, content: readFileSync(path, "utf8") };
  } catch {
    return { path, content: "" };
  }
};

const AGENT_SOUL = loadAgentSoul();

export function getAgentSoul(): string {
  return AGENT_SOUL.content;
}

export function getAgentSoulPath(): string | null {
  return AGENT_SOUL.path;
}
