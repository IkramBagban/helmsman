import Docker from "dockerode";
import type { AuditService } from "@helmsman/audit";
import { AppError } from "@helmsman/shared";
import { PassThrough } from "node:stream";
import { buildContainerConfig } from "./container-config.js";
import { injectCredentials } from "./credential-injector.js";
import { createTaskNetwork, removeTaskNetwork } from "./network-policy.js";
import { redactOutput } from "./output-redactor.js";
import type { ContainerResult, ContainerTaskSpec } from "../types.js";

export class DockerContainerOrchestrator {
  private readonly docker: Docker;
  private readonly image: string;
  private readonly auditService?: AuditService;

  public constructor(options: { docker?: Docker; image?: string; auditService?: AuditService } = {}) {
    this.docker = options.docker ?? new Docker({ socketPath: process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock" });
    this.image = options.image ?? process.env.HELMSMAN_RUNTIME_IMAGE ?? "helmsman-runtime:latest";
    this.auditService = options.auditService;
  }

  public async run(spec: ContainerTaskSpec): Promise<ContainerResult> {
    const startedAt = Date.now();
    const timeoutMs = spec.timeoutMs ?? Number(process.env.CONTAINER_DEFAULT_TIMEOUT_MS ?? 300000);
    const volumeName = `helmsman-ws-${spec.correlationId}`;
    const networkMode = await createTaskNetwork(this.docker, spec.taskId, spec.egressAllowlist ?? []);
    const injected = await injectCredentials(spec.credentials);

    await this.docker.createVolume({ Name: volumeName });
    await this.auditService?.log({
      type: "tool_execution",
      userId: "system",
      correlationId: spec.correlationId,
      metadata: { event: "devops.container.start", taskId: spec.taskId, commandCount: spec.commands.length, egressAllowlist: spec.egressAllowlist ?? [] },
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const container = await this.docker.createContainer(
      buildContainerConfig(spec, {
        image: this.image,
        volumeName,
        networkMode: networkMode === "none" ? "none" : `helmsman-net-${spec.taskId}`,
        envVars: injected.env,
        binds: injected.binds,
      }),
    );

    try {
      const stream = await container.attach({ stream: true, stdout: true, stderr: true });
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();
      stdoutStream.on("data", chunk => {
        stdout += chunk.toString("utf8");
      });
      stderrStream.on("data", chunk => {
        stderr += chunk.toString("utf8");
      });
      if (typeof this.docker.modem?.demuxStream === "function") {
        this.docker.modem.demuxStream(stream, stdoutStream, stderrStream);
      } else {
        stream.on("data", chunk => {
          stdout += chunk.toString("utf8");
        });
      }

      await container.start();
      const waitPromise = container.wait();
      const timeoutHandle = setTimeout(async () => {
        killed = true;
        try {
          await container.kill({ signal: "SIGKILL" });
        } catch {
          return;
        }
      }, timeoutMs);

      const waitResult = await waitPromise;
      clearTimeout(timeoutHandle);
      const exitCode = waitResult.StatusCode ?? 1;

      const redactedStdout = redactOutput(stdout);
      const redactedStderr = redactOutput(stderr);
      await this.auditService?.log({
        type: "tool_execution",
        userId: "system",
        correlationId: spec.correlationId,
        metadata: { event: "devops.container.end", taskId: spec.taskId, exitCode, durationMs: Date.now() - startedAt, killed },
      });

      if (killed) {
        await this.auditService?.log({
          type: "tool_execution",
          userId: "system",
          correlationId: spec.correlationId,
          metadata: { event: "devops.container.timeout", taskId: spec.taskId, timeoutMs },
        });
        throw new AppError("RUNTIME.CONTAINER_TIMEOUT", "Container timed out.", { taskId: spec.taskId });
      }

      return { exitCode, stdout: redactedStdout, stderr: redactedStderr, durationMs: Date.now() - startedAt, killed };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "Container run failed.";
      throw new AppError("RUNTIME.NON_ZERO_EXIT", message, { taskId: spec.taskId });
    } finally {
      try {
        await container.remove({ force: true });
      } catch {
        // ignore cleanup errors
      }
      try {
        await injected.cleanup();
      } catch {
        // ignore cleanup errors
      }
      try {
        await removeTaskNetwork(this.docker, spec.taskId);
      } catch {
        // ignore cleanup errors
      }
      try {
        await this.docker.getVolume(volumeName).remove({ force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
