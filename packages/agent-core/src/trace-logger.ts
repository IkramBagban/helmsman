type JsonLike = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN = /(token|secret|password|private.?key|api.?key|authorization|credential|cookie)/i;
const MAX_STRING_LENGTH = 240;
const MAX_DEPTH = 4;

const truncate = (value: string): string => {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_STRING_LENGTH)}…(truncated)`;
};

export const previewText = (value: unknown, maxLength: number = 180): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…(truncated)`;
};

export const redactForLog = (value: unknown, depth: number = 0): unknown => {
  if (depth > MAX_DEPTH) {
    return "[depth-limit]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return truncate(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactForLog(item, depth + 1));
  }

  if (typeof value === "object") {
    const output: JsonLike = {};
    for (const [key, item] of Object.entries(value as JsonLike)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = "[redacted]";
        continue;
      }
      output[key] = redactForLog(item, depth + 1);
    }
    return output;
  }

  return String(value);
};

export const logTrace = (
  event: string,
  payload: Record<string, unknown>,
  level: "info" | "warn" | "error" = "info",
): void => {
  const line = {
    component: "helmsman-agent",
    event,
    timestamp: new Date().toISOString(),
    ...redactForLog(payload) as Record<string, unknown>,
  };

  if (level === "error") {
    console.error(JSON.stringify(line));
    return;
  }

  if (level === "warn") {
    console.warn(JSON.stringify(line));
    return;
  }

  console.info(JSON.stringify(line));
};
