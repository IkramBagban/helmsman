import { z } from "zod";
import type { DockerContainerOrchestrator } from "../orchestrator/container-orchestrator.js";
import { assertSafeToken, shQuote } from "./command-utils.js";
import { createRuntimeTool } from "./shared.js";

const SshBaseSchema = z.object({
  host: z.string().min(1).describe("Target host or IP."),
  port: z.number().int().min(1).max(65535).default(22).describe("SSH port."),
  username: z.string().min(1).describe("SSH username."),
  knownHostLine: z.string().min(1).describe("Verified known_hosts line for host key pinning."),
  sshKeyVaultId: z.string().optional().describe("Vault key identifier."),
});

export const createSshExecTool = (orchestrator: DockerContainerOrchestrator) => createRuntimeTool(orchestrator, {
  name: "devops.ssh.exec", description: "Execute non-interactive SSH command.", riskTier: "significant",
  paramsSchema: SshBaseSchema.extend({ command: z.string().min(1).max(4000).describe("Remote command to execute."), timeout: z.number().int().min(1).max(300).default(60).describe("Command timeout seconds."), quietMode: z.boolean().default(false).describe("If true, suppress stdout in response.") }),
  execute: async (p, c, o) => {
    const host = assertSafeToken("host", p.host);
    const username = assertSafeToken("username", p.username);
    const run = await o.run({
      taskId: crypto.randomUUID(),
      correlationId: c.correlationId,
      commands: [`ssh -p ${p.port} ${shQuote(`${username}@${host}`)} ${shQuote(p.command)}`],
      credentials: {
        sshKeyPemBase64: typeof c.credentials?.privateKeyBase64 === "string" ? c.credentials.privateKeyBase64 : undefined,
        knownHostLine: p.knownHostLine,
        sshHost: host,
        sshUser: username,
        sshPort: String(p.port),
      },
      timeoutMs: p.timeout * 1000,
      egressAllowlist: [{ host, port: p.port, protocol: "tcp" }],
    });
    return p.quietMode ? { ...run, stdout: "" } : run;
  },
});

export const createSshFileReadTool = (orchestrator: DockerContainerOrchestrator) => createRuntimeTool(orchestrator, {
  name: "devops.ssh.fileRead", description: "Read file content over SSH.", riskTier: "significant",
  paramsSchema: SshBaseSchema.extend({ remotePath: z.string().min(1).describe("Absolute remote file path."), maxSizeBytes: z.number().int().min(1).max(1048576).default(102400).describe("Maximum bytes to read.") }),
  execute: async (p, c, o) => {
    const host = assertSafeToken("host", p.host);
    const username = assertSafeToken("username", p.username);
    const remoteCmd = `head -c ${p.maxSizeBytes} ${shQuote(p.remotePath)}`;
    return o.run({
      taskId: crypto.randomUUID(),
      correlationId: c.correlationId,
      commands: [`ssh -p ${p.port} ${shQuote(`${username}@${host}`)} ${shQuote(remoteCmd)}`],
      credentials: {
        sshKeyPemBase64: typeof c.credentials?.privateKeyBase64 === "string" ? c.credentials.privateKeyBase64 : undefined,
        knownHostLine: p.knownHostLine,
        sshHost: host,
        sshUser: username,
        sshPort: String(p.port),
      },
      egressAllowlist: [{ host, port: p.port, protocol: "tcp" }],
    });
  },
});

export const createSshFileWriteTool = (orchestrator: DockerContainerOrchestrator) => createRuntimeTool(orchestrator, {
  name: "devops.ssh.fileWrite", description: "Write file content over SSH.", riskTier: "destructive",
  paramsSchema: SshBaseSchema.extend({ remotePath: z.string().min(1).describe("Absolute remote file path."), content: z.string().describe("File content to write."), mode: z.string().regex(/^[0-7]{3,4}$/).default("644").describe("File mode after write."), backup: z.boolean().default(true).describe("Backup target file before overwrite.") }),
  execute: async (p, c, o) => {
    const host = assertSafeToken("host", p.host);
    const username = assertSafeToken("username", p.username);
    const contentBase64 = Buffer.from(p.content, "utf8").toString("base64");
    const backupCmd = p.backup ? `if [ -f ${shQuote(p.remotePath)} ]; then cp ${shQuote(p.remotePath)} ${shQuote(`${p.remotePath}.helmsman.bak`)}; fi && ` : "";
    const remoteCmd = `${backupCmd}printf %s ${shQuote(contentBase64)} | base64 -d > ${shQuote(p.remotePath)} && chmod ${p.mode} ${shQuote(p.remotePath)}`;

    return o.run({
      taskId: crypto.randomUUID(),
      correlationId: c.correlationId,
      commands: [`ssh -p ${p.port} ${shQuote(`${username}@${host}`)} ${shQuote(remoteCmd)}`],
      credentials: {
        sshKeyPemBase64: typeof c.credentials?.privateKeyBase64 === "string" ? c.credentials.privateKeyBase64 : undefined,
        knownHostLine: p.knownHostLine,
        sshHost: host,
        sshUser: username,
        sshPort: String(p.port),
      },
      egressAllowlist: [{ host, port: p.port, protocol: "tcp" }],
    });
  },
});
