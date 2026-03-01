import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContainerCredentials } from "../types.js";

export interface InjectedCredentials {
  readonly env: Record<string, string>;
  readonly binds: readonly string[];
  cleanup(): Promise<void>;
}

export const injectCredentials = async (credentials?: ContainerCredentials): Promise<InjectedCredentials> => {
  if (!credentials) {
    return { env: {}, binds: [], cleanup: async () => undefined };
  }

  const dir = await mkdtemp(join(tmpdir(), "helmsman-secrets-"));
  const binds: string[] = [];
  const env: Record<string, string> = {};

  if (credentials.sshKeyPemBase64) {
    const keyPath = join(dir, "ssh_key");
    await writeFile(keyPath, Buffer.from(credentials.sshKeyPemBase64, "base64").toString("utf8"), { mode: 0o600 });
    binds.push(`${keyPath}:/run/helmsman/secrets/ssh_key:ro`);
    env.HELMSMAN_SSH_KEY_FILE = "/run/helmsman/secrets/ssh_key";
  }

  if (credentials.gitToken) {
    const tokenPath = join(dir, "git_token");
    await writeFile(tokenPath, credentials.gitToken, { mode: 0o600 });
    binds.push(`${tokenPath}:/run/helmsman/secrets/git_token:ro`);
    env.HELMSMAN_GIT_TOKEN_FILE = "/run/helmsman/secrets/git_token";
  }

  if (credentials.knownHostLine) {
    const knownHostsPath = join(dir, "known_hosts");
    await writeFile(knownHostsPath, credentials.knownHostLine, { mode: 0o600 });
    binds.push(`${knownHostsPath}:/run/helmsman/secrets/known_hosts:ro`);
    env.HELMSMAN_KNOWN_HOSTS_FILE = "/run/helmsman/secrets/known_hosts";
  }

  if (credentials.sshHost) env.HELMSMAN_SSH_HOST = credentials.sshHost;
  if (credentials.sshUser) env.HELMSMAN_SSH_USER = credentials.sshUser;
  if (credentials.sshPort) env.HELMSMAN_SSH_PORT = credentials.sshPort;

  return {
    env,
    binds,
    cleanup: async () => {
      await rm(dir, { force: true, recursive: true });
    },
  };
};
