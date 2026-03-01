import { z } from "zod";
import type { DockerContainerOrchestrator } from "../orchestrator/container-orchestrator.js";
import { assertSafeEnvName, requireWorkspacePath, shQuote } from "./command-utils.js";
import { createRuntimeTool } from "./shared.js";

export const createShellRunTool = (orchestrator: DockerContainerOrchestrator) => createRuntimeTool(orchestrator, {
  name: "devops.shell.run",
  description: "Run shell command in isolated container workspace.",
  riskTier: "destructive",
  paramsSchema: z.object({
    workdir: z.string().min(1).describe("Absolute workspace path inside container."),
    command: z.string().min(1).max(4000).describe("Shell command to run in runtime container."),
    env: z.object({}).catchall(z.string()).optional().describe("Additional environment variables."),
    timeout: z.number().int().min(1).max(300).default(60).describe("Timeout in seconds."),
    egressAllowlist: z.array(z.object({ host: z.string().min(1).describe("Allowed destination host."), port: z.number().int().min(1).max(65535).describe("Allowed destination port."), protocol: z.enum(["tcp", "udp"]).describe("Allowed destination protocol.") })).default([]).describe("Explicit default-deny egress allowlist."),
  }),
  execute: async (p, c, o) => {
    const workdir = requireWorkspacePath(p.workdir);
    const envExports = Object.entries(p.env ?? {}).map(([key, value]) => `export ${assertSafeEnvName(key)}=${shQuote(value)}`).join(" && ");
    const command = [
      `cd ${shQuote(workdir)}`,
      envExports,
      p.command,
    ].filter(Boolean).join(" && ");

    return o.run({ taskId: crypto.randomUUID(), correlationId: c.correlationId, commands: [command], timeoutMs: p.timeout * 1000, egressAllowlist: p.egressAllowlist });
  },
});
