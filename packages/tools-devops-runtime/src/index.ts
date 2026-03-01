import type Docker from "dockerode";
import type { AuditService } from "@helmsman/audit";
import { DockerContainerOrchestrator } from "./orchestrator/container-orchestrator.js";
import { createGitCheckoutTool, createGitCloneTool, createGitCommitTool, createGitDiffTool, createGitLogTool, createGitPullTool, createGitPushTool, createGitStatusTool } from "./tools/git-tools.js";
import { createShellRunTool } from "./tools/shell-run.js";
import { createSshExecTool, createSshFileReadTool, createSshFileWriteTool } from "./tools/ssh-tools.js";

export * from "./types.js";
export * from "./orchestrator/container-orchestrator.js";
export * from "./orchestrator/output-redactor.js";

export const createDevopsRuntimeTools = (options: { docker?: Docker; auditService?: AuditService; image?: string } = {}) => {
  const orchestrator = new DockerContainerOrchestrator(options);
  return [
    createGitCloneTool(orchestrator),
    createGitStatusTool(orchestrator),
    createGitDiffTool(orchestrator),
    createGitLogTool(orchestrator),
    createGitCheckoutTool(orchestrator),
    createGitPullTool(orchestrator),
    createGitCommitTool(orchestrator),
    createGitPushTool(orchestrator),
    createSshExecTool(orchestrator),
    createSshFileReadTool(orchestrator),
    createSshFileWriteTool(orchestrator),
    createShellRunTool(orchestrator),
  ];
};
