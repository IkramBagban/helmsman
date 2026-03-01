import type { ToolCredentials } from "@helmsman/tools";

export interface EgressRule {
  readonly host: string;
  readonly port: number;
  readonly protocol: "tcp" | "udp";
}

export interface ContainerCredentials {
  readonly sshKeyPemBase64?: string;
  readonly gitToken?: string;
  readonly knownHostLine?: string;
  readonly sshHost?: string;
  readonly sshUser?: string;
  readonly sshPort?: string;
}

export interface ContainerTaskSpec {
  readonly taskId: string;
  readonly commands: readonly string[];
  readonly correlationId: string;
  readonly credentials?: ContainerCredentials;
  readonly timeoutMs?: number;
  readonly cpuQuota?: number;
  readonly memoryBytes?: number;
  readonly egressAllowlist?: readonly EgressRule[];
}

export interface ContainerResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly killed: boolean;
}

export interface SSHCredentials extends ToolCredentials {
  readonly provider: "ssh";
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly privateKeyBase64: string;
  readonly passphrase?: string;
  readonly knownHostLine: string;
}

export interface GitCredentials extends ToolCredentials {
  readonly provider: "git";
  readonly token?: string;
  readonly username?: string;
}
