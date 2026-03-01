import type { ContainerCreateOptions } from "dockerode";
import type { ContainerTaskSpec } from "../types.js";

interface BuildConfigOptions {
  readonly image: string;
  readonly volumeName: string;
  readonly networkMode: string;
  readonly envVars: Record<string, string>;
  readonly binds: readonly string[];
}

export const buildContainerConfig = (spec: ContainerTaskSpec, options: BuildConfigOptions): ContainerCreateOptions => {
  const commandScript = spec.commands.join(" && ");

  return {
    name: `helmsman-task-${spec.taskId}`,
    Image: options.image,
    Cmd: ["/bin/bash", "-lc", commandScript],
    WorkingDir: "/workspace",
    AttachStdout: true,
    AttachStderr: true,
    HostConfig: {
      AutoRemove: false,
      ReadonlyRootfs: false,
      Memory: spec.memoryBytes ?? Number(process.env.CONTAINER_DEFAULT_MEMORY_BYTES ?? 268435456),
      CpuQuota: Math.floor((spec.cpuQuota ?? Number(process.env.CONTAINER_DEFAULT_CPU_QUOTA ?? 0.5)) * 100000),
      NetworkMode: options.networkMode,
      Binds: [`${options.volumeName}:/workspace`, ...options.binds],
      Tmpfs: {
        "/run/helmsman/secrets": "rw,noexec,nosuid,size=1m",
      },
      SecurityOpt: ["no-new-privileges"],
      CapDrop: ["ALL"],
    },
    Env: Object.entries(options.envVars).map(([key, value]) => `${key}=${value}`),
  };
};
