import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  PendingScheduleDraft,
  ScheduleRecord,
  ScheduleRunRecord,
  ScheduleRunStoreDocument,
  ScheduleSourceContext,
  ScheduleStoreDocument,
} from "./types.js";

const defaultScheduleStore = (): ScheduleStoreDocument => ({
  version: 1,
  schedules: [],
  pendingDrafts: [],
});

const defaultRunStore = (): ScheduleRunStoreDocument => ({
  version: 1,
  runs: [],
});

const nowIso = (): string => new Date().toISOString();

const writeJsonAtomic = async <T>(path: string, value: T): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  const data = JSON.stringify(value, null, 2);
  await writeFile(tempPath, data, "utf8");
  try {
    await rename(tempPath, path);
  } catch (error: any) {
    if (error.code === "EPERM" || error.code === "EBUSY") {
      // Fallback for Windows file locks (e.g., when Vite is watching the file)
      await writeFile(path, data, "utf8");
    } else {
      throw error;
    }
  }
};

const safeReadJson = async <T>(path: string, fallback: T): Promise<T> => {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export interface JsonScheduleRepositoryConfig {
  readonly dataDir: string;
  readonly runRetention: number;
}

export class JsonScheduleRepository {
  private readonly schedulesPath: string;
  private readonly runsPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly config: JsonScheduleRepositoryConfig) {
    this.schedulesPath = join(config.dataDir, "schedules.json");
    this.runsPath = join(config.dataDir, "schedule-runs.json");
  }

  private async enqueueWrite(task: () => Promise<void>): Promise<void> {
    this.writeQueue = this.writeQueue.then(task, task);
    await this.writeQueue;
  }

  public async initialize(): Promise<void> {
    const schedules = await safeReadJson<ScheduleStoreDocument>(this.schedulesPath, defaultScheduleStore());
    const runs = await safeReadJson<ScheduleRunStoreDocument>(this.runsPath, defaultRunStore());
    await writeJsonAtomic(this.schedulesPath, schedules.version === 1 ? schedules : defaultScheduleStore());
    await writeJsonAtomic(this.runsPath, runs.version === 1 ? runs : defaultRunStore());
  }

  public async listSchedulesByOwner(userId: string, chatId: string): Promise<ScheduleRecord[]> {
    const document = await safeReadJson<ScheduleStoreDocument>(this.schedulesPath, defaultScheduleStore());
    return document.schedules.filter((item) => item.ownerUserId === userId && item.chatId === chatId);
  }

  public async listActiveSchedules(): Promise<ScheduleRecord[]> {
    const document = await safeReadJson<ScheduleStoreDocument>(this.schedulesPath, defaultScheduleStore());
    return document.schedules.filter((item) => item.status === "active" || item.status === "degraded");
  }

  public async createPendingDraft(input: {
    source: ScheduleSourceContext;
    action: ScheduleRecord["action"];
    pattern: ScheduleRecord["pattern"];
    riskTier: ScheduleRecord["riskTier"];
    ttlMinutes: number;
  }): Promise<PendingScheduleDraft> {
    const createdAt = nowIso();
    const draft: PendingScheduleDraft = {
      approvalToken: randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(),
      createdAtIso: createdAt,
      expiresAtIso: new Date(Date.now() + input.ttlMinutes * 60 * 1000).toISOString(),
      source: input.source,
      action: input.action,
      pattern: input.pattern,
      riskTier: input.riskTier,
    };

    await this.enqueueWrite(async () => {
      const document = await safeReadJson<ScheduleStoreDocument>(this.schedulesPath, defaultScheduleStore());
      const next = {
        ...document,
        pendingDrafts: [
          ...document.pendingDrafts.filter((item) => new Date(item.expiresAtIso).getTime() > Date.now()),
          draft,
        ],
      } satisfies ScheduleStoreDocument;
      await writeJsonAtomic(this.schedulesPath, next);
    });

    return draft;
  }

  public async consumePendingDraft(token: string, userId: string, chatId: string): Promise<PendingScheduleDraft | null> {
    let consumed: PendingScheduleDraft | null = null;
    await this.enqueueWrite(async () => {
      const document = await safeReadJson<ScheduleStoreDocument>(this.schedulesPath, defaultScheduleStore());
      const normalizedToken = token.toUpperCase();
      const pending = document.pendingDrafts.filter((item) => new Date(item.expiresAtIso).getTime() > Date.now());

      consumed = pending.find((item) =>
        item.approvalToken === normalizedToken
        && item.source.userId === userId
        && item.source.chatId === chatId,
      ) ?? null;

      const next = {
        ...document,
        pendingDrafts: pending.filter((item) => item.approvalToken !== normalizedToken),
      } satisfies ScheduleStoreDocument;
      await writeJsonAtomic(this.schedulesPath, next);
    });

    return consumed;
  }

  public async createScheduleFromDraft(draft: PendingScheduleDraft): Promise<ScheduleRecord> {
    const now = nowIso();
    const record: ScheduleRecord = {
      id: randomUUID(),
      ownerUserId: draft.source.userId,
      platform: draft.source.platform,
      chatId: draft.source.chatId,
      sourceMessageId: draft.source.messageId,
      sourceText: draft.source.originalText,
      action: draft.action,
      pattern: draft.pattern,
      riskTier: draft.riskTier,
      status: "active",
      createdAtIso: now,
      updatedAtIso: now,
      consecutiveFailures: 0,
      runsCompleted: 0,
    };

    await this.enqueueWrite(async () => {
      const document = await safeReadJson<ScheduleStoreDocument>(this.schedulesPath, defaultScheduleStore());
      const next = {
        ...document,
        schedules: [...document.schedules, record],
      } satisfies ScheduleStoreDocument;
      await writeJsonAtomic(this.schedulesPath, next);
    });

    return record;
  }

  public async updateSchedule(record: ScheduleRecord): Promise<void> {
    await this.enqueueWrite(async () => {
      const document = await safeReadJson<ScheduleStoreDocument>(this.schedulesPath, defaultScheduleStore());
      const next = {
        ...document,
        schedules: document.schedules.map((item) => item.id === record.id ? record : item),
      } satisfies ScheduleStoreDocument;
      await writeJsonAtomic(this.schedulesPath, next);
    });
  }

  public async deleteSchedule(id: string): Promise<void> {
    await this.enqueueWrite(async () => {
      const document = await safeReadJson<ScheduleStoreDocument>(this.schedulesPath, defaultScheduleStore());
      const next = {
        ...document,
        schedules: document.schedules.filter((item) => item.id !== id),
      } satisfies ScheduleStoreDocument;
      await writeJsonAtomic(this.schedulesPath, next);
    });
  }

  public async getScheduleById(id: string): Promise<ScheduleRecord | null> {
    const document = await safeReadJson<ScheduleStoreDocument>(this.schedulesPath, defaultScheduleStore());
    return document.schedules.find((item) => item.id === id) ?? null;
  }

  public async appendRun(run: ScheduleRunRecord): Promise<void> {
    await this.enqueueWrite(async () => {
      const document = await safeReadJson<ScheduleRunStoreDocument>(this.runsPath, defaultRunStore());
      const bounded = [run, ...document.runs].slice(0, this.config.runRetention);
      const next = {
        ...document,
        runs: bounded,
      } satisfies ScheduleRunStoreDocument;
      await writeJsonAtomic(this.runsPath, next);
    });
  }

  public async hasRunKey(idempotencyKey: string): Promise<boolean> {
    const document = await safeReadJson<ScheduleRunStoreDocument>(this.runsPath, defaultRunStore());
    return document.runs.some((run) => run.idempotencyKey === idempotencyKey);
  }

  public async listRuns(scheduleId: string, limit: number = 10): Promise<ScheduleRunRecord[]> {
    const document = await safeReadJson<ScheduleRunStoreDocument>(this.runsPath, defaultRunStore());
    return document.runs.filter((run) => run.scheduleId === scheduleId).slice(0, Math.max(1, limit));
  }
}
