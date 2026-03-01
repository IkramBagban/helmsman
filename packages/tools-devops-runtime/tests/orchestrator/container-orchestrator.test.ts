import { describe, expect, it } from "bun:test";
import { DockerContainerOrchestrator } from "../../src/orchestrator/container-orchestrator.js";

describe("DockerContainerOrchestrator", () => {
  it("should create and remove container via dockerode interface", async () => {
    const previousEnforcement = process.env.HELMSMAN_ENFORCE_EGRESS_ALLOWLIST;
    process.env.HELMSMAN_ENFORCE_EGRESS_ALLOWLIST = "true";

    const lifecycle: string[] = [];
    const mockContainer = {
      attach: async () => ({ on: () => undefined }),
      start: async () => {
        lifecycle.push("start");
      },
      wait: async () => ({ StatusCode: 0 }),
      remove: async () => {
        lifecycle.push("remove");
      },
      kill: async () => undefined,
    };

    const docker = {
      createNetwork: async () => ({ id: "net" }),
      getNetwork: () => ({ remove: async () => undefined }),
      createVolume: async () => undefined,
      createContainer: async () => mockContainer,
    } as never;

    const orchestrator = new DockerContainerOrchestrator({ docker, image: "helmsman-runtime:latest" });
    const result = await orchestrator.run({ taskId: "task", correlationId: "corr", commands: ["echo test"], egressAllowlist: [{ host: "github.com", port: 443, protocol: "tcp" }] });

    if (previousEnforcement === undefined) {
      delete process.env.HELMSMAN_ENFORCE_EGRESS_ALLOWLIST;
    } else {
      process.env.HELMSMAN_ENFORCE_EGRESS_ALLOWLIST = previousEnforcement;
    }

    expect(result.exitCode).toBe(0);
    expect(lifecycle).toEqual(["start", "remove"]);
  });
});
