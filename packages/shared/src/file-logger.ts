import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type LogLevel = "info" | "warn" | "error";

export interface FileLoggerOptions {
  readonly component: string;
  readonly fileName?: string;
  readonly logDir?: string;
}

const DEFAULT_LOG_FILE = "helmsman.log";

const getLogFilePath = (options: FileLoggerOptions): string => {
  const baseDir = options.logDir ?? process.env.HELMSMAN_LOG_DIR ?? resolve(process.cwd(), "logs");
  return resolve(baseDir, options.fileName ?? DEFAULT_LOG_FILE);
};

const normalize = (payload: unknown): unknown => {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (typeof payload === "bigint") {
    return payload.toString();
  }

  if (typeof payload === "number" || typeof payload === "string" || typeof payload === "boolean") {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((entry) => normalize(entry));
  }

  if (typeof payload === "object") {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      normalized[key] = normalize(value);
    }
    return normalized;
  }

  return String(payload);
};

export interface FileLogEntry {
  readonly component: string;
  readonly event: string;
  readonly level: LogLevel;
  readonly timestamp: string;
  readonly payload: Record<string, unknown>;
}

export interface FileLogger {
  log(level: LogLevel, event: string, payload: Record<string, unknown>): void;
}

export const createFileLogger = (options: FileLoggerOptions): FileLogger => {
  const filePath = getLogFilePath(options);
  const logDirectory = dirname(filePath);
  let initialized = false;

  const ensureDirectory = async (): Promise<void> => {
    if (initialized) {
      return;
    }

    await mkdir(logDirectory, { recursive: true });
    initialized = true;
  };

  const writeLine = async (line: string): Promise<void> => {
    try {
      await ensureDirectory();
      await appendFile(filePath, line, "utf8");
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      console.error(`[file-logger] failed to write log line: ${failure}`);
    }
  };

  return {
    log(level: LogLevel, event: string, payload: Record<string, unknown>): void {
      const entry: FileLogEntry = {
        component: options.component,
        event,
        level,
        timestamp: new Date().toISOString(),
        payload: normalize(payload) as Record<string, unknown>,
      };

      void writeLine(`${JSON.stringify(entry)}\n`);
    },
  };
};
