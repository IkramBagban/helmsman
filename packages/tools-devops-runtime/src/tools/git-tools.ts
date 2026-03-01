import { AppError } from "@helmsman/shared";
import { z } from "zod";
import type { DockerContainerOrchestrator } from "../orchestrator/container-orchestrator.js";
import { assertSafeToken, requireWorkspacePath, shQuote } from "./command-utils.js";
import { createRuntimeTool } from "./shared.js";

const WorkdirSchema = z.object({ workdir: z.string().min(1).describe("Absolute workspace path inside container.") });

export const createGitCloneTool = (orchestrator: DockerContainerOrchestrator) => createRuntimeTool(orchestrator, {
  name: "devops.git.clone",
  description: "Clone git repository in isolated runtime container.",
  riskTier: "low_risk",
  paramsSchema: z.object({
    repoUrl: z.string().url().describe("HTTPS or SSH repository URL."),
    branch: z.string().optional().describe("Optional branch to clone."),
    depth: z.number().int().min(1).optional().describe("Optional shallow clone depth."),
    requiresAuth: z.boolean().default(false).describe("Whether repository needs auth token."),
  }),
  execute: async (p, c, o) => {
    const gitToken = typeof c.credentials?.token === "string" ? c.credentials.token : undefined;
    if (p.requiresAuth && !gitToken) {
      throw new AppError("GIT.AUTH_FAILED", "requiresAuth=true but no git token is available in tool context.");
    }

    return o.run({
      taskId: crypto.randomUUID(),
      correlationId: c.correlationId,
      commands: [
        `git clone ${p.depth ? `--depth ${p.depth} ` : ""}${p.branch ? `--branch ${shQuote(p.branch)} ` : ""}${shQuote(p.repoUrl)}`,
      ],
      credentials: gitToken ? { gitToken } : undefined,
      timeoutMs: c.timeout,
    });
  },
});

export const createGitStatusTool = (orchestrator: DockerContainerOrchestrator) => createRuntimeTool(orchestrator, {
  name: "devops.git.status", description: "Read git status.", riskTier: "read_only", paramsSchema: WorkdirSchema,
  execute: async (p, c, o) => o.run({ taskId: crypto.randomUUID(), correlationId: c.correlationId, commands: [`cd ${shQuote(requireWorkspacePath(p.workdir))} && git status --porcelain=v1 -b`], timeoutMs: c.timeout }),
});

export const createGitDiffTool = (orchestrator: DockerContainerOrchestrator) => createRuntimeTool(orchestrator, {
  name: "devops.git.diff", description: "Read git diff.", riskTier: "read_only",
  paramsSchema: WorkdirSchema.extend({ from: z.string().optional().describe("Base ref."), to: z.string().optional().describe("Target ref."), paths: z.array(z.string().min(1).describe("Path entry.")).optional().describe("Path filters."), stat: z.boolean().default(false).describe("Return stat only."), maxLines: z.number().int().min(1).max(2000).default(500).describe("Maximum lines in response.") }),
  execute: async (p, c, o) => {
    const refs = [p.from, p.to].filter((item): item is string => Boolean(item)).map(item => shQuote(item));
    const paths = p.paths?.map(item => shQuote(item)).join(" ") ?? "";
    const base = `cd ${shQuote(requireWorkspacePath(p.workdir))} && git diff ${p.stat ? "--stat" : ""} ${refs.join(" ")} ${paths}`.trim();
    return o.run({ taskId: crypto.randomUUID(), correlationId: c.correlationId, commands: [`${base} | head -n ${p.maxLines}`], timeoutMs: c.timeout });
  },
});

export const createGitLogTool = (orchestrator: DockerContainerOrchestrator) => createRuntimeTool(orchestrator, {
  name: "devops.git.log", description: "Read commit history.", riskTier: "read_only", paramsSchema: WorkdirSchema,
  execute: async (p, c, o) => o.run({ taskId: crypto.randomUUID(), correlationId: c.correlationId, commands: [`cd ${shQuote(requireWorkspacePath(p.workdir))} && git log --oneline -n 25`], timeoutMs: c.timeout }),
});

export const createGitCheckoutTool = (orchestrator: DockerContainerOrchestrator) => createRuntimeTool(orchestrator, {
  name: "devops.git.checkout", description: "Switch branch/ref.", riskTier: "low_risk", paramsSchema: WorkdirSchema.extend({ ref: z.string().min(1).describe("Branch or ref to checkout.") }),
  execute: async (p, c, o) => o.run({ taskId: crypto.randomUUID(), correlationId: c.correlationId, commands: [`cd ${shQuote(requireWorkspacePath(p.workdir))} && git checkout ${shQuote(p.ref)}`], timeoutMs: c.timeout }),
});

export const createGitPullTool = (orchestrator: DockerContainerOrchestrator) => createRuntimeTool(orchestrator, {
  name: "devops.git.pull", description: "Pull from remote.", riskTier: "low_risk", paramsSchema: WorkdirSchema.extend({ remote: z.string().default("origin").describe("Remote name."), branch: z.string().optional().describe("Branch to pull.") }),
  execute: async (p, c, o) => {
    const remote = assertSafeToken("remote", p.remote);
    const branch = p.branch ? shQuote(p.branch) : "";
    return o.run({ taskId: crypto.randomUUID(), correlationId: c.correlationId, commands: [`cd ${shQuote(requireWorkspacePath(p.workdir))} && git pull ${remote} ${branch}`], timeoutMs: c.timeout });
  },
});

export const createGitCommitTool = (orchestrator: DockerContainerOrchestrator) => createRuntimeTool(orchestrator, {
  name: "devops.git.commit", description: "Commit changes.", riskTier: "low_risk",
  paramsSchema: WorkdirSchema.extend({ message: z.string().min(1).max(500).describe("Commit message."), authorName: z.string().optional().describe("Optional author name."), authorEmail: z.string().email().optional().describe("Optional author email."), addAll: z.boolean().default(false).describe("Stage all files before commit."), paths: z.array(z.string().min(1).describe("Path to stage.")).optional().describe("Specific paths to stage.") }).refine(data => data.addAll || (data.paths?.length ?? 0) > 0, { message: "paths must be provided when addAll is false" }),
  execute: async (p, c, o) => {
    const stageCmd = p.addAll ? "git add -A" : `git add ${p.paths?.map(item => shQuote(item)).join(" ")}`;
    const author = p.authorName && p.authorEmail ? `--author='${p.authorName} <${p.authorEmail}>'` : "";
    return o.run({ taskId: crypto.randomUUID(), correlationId: c.correlationId, commands: [`cd ${shQuote(requireWorkspacePath(p.workdir))} && ${stageCmd} && git commit ${author} -m ${shQuote(p.message)}`], timeoutMs: c.timeout });
  },
});

export const createGitPushTool = (orchestrator: DockerContainerOrchestrator) => createRuntimeTool(orchestrator, {
  name: "devops.git.push", description: "Push branch to remote.", riskTier: "significant",
  paramsSchema: WorkdirSchema.extend({ remote: z.string().default("origin").describe("Remote name."), branch: z.string().min(1).describe("Branch to push."), force: z.boolean().default(false).describe("Force push if true."), dryRun: z.boolean().default(false).describe("Dry run push without update.") }),
  execute: async (p, c, o) => {
    const remote = assertSafeToken("remote", p.remote);
    return o.run({ taskId: crypto.randomUUID(), correlationId: c.correlationId, commands: [`cd ${shQuote(requireWorkspacePath(p.workdir))} && git push ${p.dryRun ? "--dry-run" : ""} ${p.force ? "--force" : ""} ${remote} ${shQuote(p.branch)}`], timeoutMs: c.timeout });
  },
});
