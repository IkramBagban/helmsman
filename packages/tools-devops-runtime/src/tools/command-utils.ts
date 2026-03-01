import { AppError } from "@helmsman/shared";

const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9._:@/-]+$/;
const SAFE_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export function shQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function requireWorkspacePath(path: string): string {
  const normalized = path.trim();
  if (!normalized.startsWith("/workspace")) {
    throw new AppError("DEVOPS.INVALID_WORKDIR", "workdir must be inside /workspace", { workdir: path });
  }
  return normalized;
}

export function assertSafeToken(label: string, value: string): string {
  if (!SAFE_TOKEN_PATTERN.test(value)) {
    throw new AppError("DEVOPS.UNSAFE_TOKEN", `Unsafe ${label} value.`, { label });
  }
  return value;
}

export function assertSafeEnvName(name: string): string {
  if (!SAFE_ENV_NAME_PATTERN.test(name)) {
    throw new AppError("DEVOPS.INVALID_ENV_NAME", "Invalid environment variable name.", { name });
  }
  return name;
}
