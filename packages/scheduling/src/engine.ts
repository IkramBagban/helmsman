import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { HelmsmanOrchestrator } from "@helmsman/agent-core";
import type { NormalizedMessage } from "@helmsman/shared";

import type { ScheduleMessageSender } from "./sender.js";
import { JsonScheduleRepository } from "./store.js";
import type { ScheduleRecord, ScheduleRunRecord } from "./types.js";

const MAX_DELAY_MS = 2_147_000_000;
const FAILURE_NOTIFY_THRESHOLD = 3;
const FAILURE_AUTO_PAUSE_THRESHOLD = 5;
const HTTP_PING_TIMEOUT_MS = 10_000;
const LOCAL_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

const toIso = (date: Date): string => date.toISOString();

const parseMinutes = (time: string): number | null => {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
};

const zonedTimeKey = (date: Date, timezone: string): string => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
};

const findNextDailyRun = (timezone: string, timesOfDay: readonly string[], from: Date): Date | null => {
  if (timesOfDay.length === 0) {
    return null;
  }

  const validTimes = timesOfDay
    .map(parseMinutes)
    .filter((value): value is number => typeof value === "number");

  if (validTimes.length === 0) {
    return null;
  }

  const targetKeys = new Set(
    validTimes.map((value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`),
  );

  const startMs = from.getTime();
  for (let minuteOffset = 1; minuteOffset <= 60 * 48; minuteOffset += 1) {
    const candidate = new Date(startMs + minuteOffset * 60_000);
    const key = zonedTimeKey(candidate, timezone);
    if (targetKeys.has(key)) {
      return new Date(Math.floor(candidate.getTime() / 60_000) * 60_000);
    }
  }

  return null;
};

const computeNextRun = (schedule: ScheduleRecord, from: Date = new Date()): Date | null => {
  if (schedule.status !== "active" && schedule.status !== "degraded") {
    return null;
  }

  if (schedule.pattern.type === "once") {
    const runAtIso = schedule.pattern.runAtIso;
    if (!runAtIso) {
      return null;
    }
    const runAt = new Date(runAtIso);
    if (Number.isNaN(runAt.getTime()) || runAt.getTime() <= from.getTime()) {
      return null;
    }
    return runAt;
  }

  if (schedule.pattern.type === "interval") {
    // Support both intervalMinutes and intervalSeconds
    const intervalMs = schedule.pattern.intervalSeconds
      ? schedule.pattern.intervalSeconds * 1_000
      : (schedule.pattern.intervalMinutes ?? 0) * 60_000;
    if (intervalMs <= 0) {
      return null;
    }

    // Check maxRuns bound
    if (schedule.pattern.maxRuns && (schedule.runsCompleted ?? 0) >= schedule.pattern.maxRuns) {
      return null;
    }

    const baseline = schedule.lastRunAtIso ? new Date(schedule.lastRunAtIso) : new Date(schedule.createdAtIso);
    if (Number.isNaN(baseline.getTime())) {
      return new Date(from.getTime() + intervalMs);
    }

    let candidate = new Date(baseline.getTime() + intervalMs);
    while (candidate.getTime() <= from.getTime()) {
      candidate = new Date(candidate.getTime() + intervalMs);
    }
    return candidate;
  }

  if (schedule.pattern.type === "daily_times") {
    return findNextDailyRun(schedule.pattern.timezone, schedule.pattern.timesOfDay ?? [], from);
  }

  return null;
};

const isPrivateIpv4 = (ip: string): boolean => {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }

  const a = parts[0];
  const b = parts[1];
  if (a == null || b == null) {
    return true;
  }

  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;

  return false;
};

const isPrivateIpv6 = (ip: string): boolean => {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isPrivateIpv4(mapped);
  }

  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }

  if (/^fe[89ab]/.test(normalized)) {
    return true;
  }

  return false;
};

const isPrivateIpAddress = (value: string): boolean => {
  const ipVersion = isIP(value);
  if (ipVersion === 4) {
    return isPrivateIpv4(value);
  }
  if (ipVersion === 6) {
    return isPrivateIpv6(value);
  }
  return true;
};

const validateHttpPingTarget = async (rawUrl: string): Promise<{ safe: true; url: URL } | { safe: false; reason: string }> => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }

  if (parsed.protocol !== "https:") {
    return { safe: false, reason: "Only https:// URLs are allowed for scheduled HTTP checks." };
  }

  if (parsed.username || parsed.password) {
    return { safe: false, reason: "Embedded credentials are not allowed in URLs." };
  }

  if (parsed.port && parsed.port !== "443") {
    return { safe: false, reason: "Custom ports are not allowed for scheduled HTTP checks." };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (LOCAL_HOSTNAMES.has(hostname)) {
    return { safe: false, reason: "Localhost destinations are not allowed." };
  }

  if (isIP(hostname) > 0 && isPrivateIpAddress(hostname)) {
    return { safe: false, reason: "Private or link-local IP destinations are not allowed." };
  }

  if (isIP(hostname) === 0) {
    try {
      const resolved = await lookup(hostname, { all: true, verbatim: true });
      if (resolved.length === 0) {
        return { safe: false, reason: "Could not resolve target host." };
      }

      const hasBlockedIp = resolved.some((entry) => isPrivateIpAddress(entry.address));
      if (hasBlockedIp) {
        return { safe: false, reason: "Target resolves to a private or link-local IP address." };
      }
    } catch {
      return { safe: false, reason: "Failed to resolve target host." };
    }
  }

  return { safe: true, url: parsed };
};

export interface SchedulerEngineConfig {
  readonly repository: JsonScheduleRepository;
  readonly sender: ScheduleMessageSender;
  readonly orchestrator: HelmsmanOrchestrator;
}

export class SchedulerEngine {
  private readonly repository: JsonScheduleRepository;
  private readonly sender: ScheduleMessageSender;
  private readonly orchestrator: HelmsmanOrchestrator;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  public constructor(config: SchedulerEngineConfig) {
    this.repository = config.repository;
    this.sender = config.sender;
    this.orchestrator = config.orchestrator;
  }

  public async start(): Promise<void> {
    const schedules = await this.repository.listActiveSchedules();
    for (const schedule of schedules) {
      await this.arm(schedule.id);
    }
  }

  public stop(): void {
    for (const [id, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  public async arm(scheduleId: string): Promise<void> {
    this.clearTimer(scheduleId);
    const schedule = await this.repository.getScheduleById(scheduleId);
    if (!schedule) {
      return;
    }

    const nextRun = computeNextRun(schedule);
    if (!nextRun) {
      if (schedule.pattern.type === "once" && schedule.status !== "completed") {
        await this.repository.updateSchedule({
          ...schedule,
          status: "completed",
          nextRunAtIso: undefined,
          updatedAtIso: toIso(new Date()),
        });
      }
      return;
    }

    await this.repository.updateSchedule({
      ...schedule,
      nextRunAtIso: toIso(nextRun),
      updatedAtIso: toIso(new Date()),
    });

    const delay = nextRun.getTime() - Date.now();
    if (delay <= 0) {
      await this.run(scheduleId, nextRun);
      return;
    }

    if (delay > MAX_DELAY_MS) {
      const timer = setTimeout(() => {
        void this.arm(scheduleId);
      }, MAX_DELAY_MS);
      this.timers.set(scheduleId, timer);
      return;
    }

    const timer = setTimeout(() => {
      void this.run(scheduleId, nextRun);
    }, delay);
    this.timers.set(scheduleId, timer);
  }

  public async pause(scheduleId: string): Promise<void> {
    this.clearTimer(scheduleId);
    const schedule = await this.repository.getScheduleById(scheduleId);
    if (!schedule) {
      return;
    }
    await this.repository.updateSchedule({
      ...schedule,
      status: "paused",
      nextRunAtIso: undefined,
      updatedAtIso: toIso(new Date()),
    });
  }

  public async resume(scheduleId: string): Promise<boolean> {
    const schedule = await this.repository.getScheduleById(scheduleId);
    if (!schedule) {
      return false;
    }

    if (schedule.status === "active") {
      return true;
    }

    await this.repository.updateSchedule({
      ...schedule,
      status: "active",
      consecutiveFailures: 0,
      updatedAtIso: toIso(new Date()),
    });
    await this.arm(scheduleId);
    return true;
  }

  public async cancel(scheduleId: string): Promise<void> {
    this.clearTimer(scheduleId);
    const schedule = await this.repository.getScheduleById(scheduleId);
    if (!schedule) {
      return;
    }
    await this.repository.updateSchedule({
      ...schedule,
      status: "cancelled",
      nextRunAtIso: undefined,
      updatedAtIso: toIso(new Date()),
    });
  }

  public async delete(scheduleId: string): Promise<void> {
    this.clearTimer(scheduleId);
    await this.repository.deleteSchedule(scheduleId);
  }

  public async runNow(scheduleId: string): Promise<boolean> {
    const schedule = await this.repository.getScheduleById(scheduleId);
    if (!schedule) {
      return false;
    }

    if (schedule.status !== "active" && schedule.status !== "degraded") {
      await this.repository.updateSchedule({
        ...schedule,
        status: "active",
        updatedAtIso: toIso(new Date()),
      });
    }

    await this.run(scheduleId, new Date());
    return true;
  }

  private clearTimer(scheduleId: string): void {
    const timer = this.timers.get(scheduleId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.timers.delete(scheduleId);
  }

  private async run(scheduleId: string, plannedAt: Date): Promise<void> {
    this.clearTimer(scheduleId);
    const schedule = await this.repository.getScheduleById(scheduleId);
    if (!schedule || (schedule.status !== "active" && schedule.status !== "degraded")) {
      return;
    }

    const idempotencyKey = `${schedule.id}:${plannedAt.toISOString()}`;
    if (await this.repository.hasRunKey(idempotencyKey)) {
      const now = new Date();
      await this.repository.appendRun({
        id: randomUUID(),
        scheduleId: schedule.id,
        idempotencyKey,
        platform: schedule.platform,
        chatId: schedule.chatId,
        sourceMessageId: schedule.sourceMessageId,
        plannedAtIso: plannedAt.toISOString(),
        startedAtIso: now.toISOString(),
        finishedAtIso: now.toISOString(),
        status: "skipped_idempotent",
        resultSummary: "Skipped duplicate trigger",
      });
      await this.arm(schedule.id);
      return;
    }

    const startedAt = new Date();
    let runStatus: ScheduleRunRecord["status"] = "success";
    let resultSummary = "Completed";
    let errorSummary: string | undefined;

    try {
      if (schedule.action.type === "http_ping" && schedule.action.url) {
        const targetCheck = await validateHttpPingTarget(schedule.action.url);
        if (!targetCheck.safe) {
          throw new Error(targetCheck.reason);
        }

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), HTTP_PING_TIMEOUT_MS);

        const response = await fetch(targetCheck.url.toString(), {
          method: "GET",
          redirect: "error",
          signal: abortController.signal,
        }).finally(() => clearTimeout(timeout));

        resultSummary = `HTTP ${response.status} from ${schedule.action.url}`;
        await this.sender.sendResponse(schedule.chatId, `⏱️ Scheduled HTTP check: ${resultSummary}`, schedule.platform);
      } else if (schedule.action.type === "reminder") {
        const reminder = schedule.action.reminderText ?? schedule.action.title;
        resultSummary = `Reminder delivered: ${reminder}`;
        await this.sender.sendResponse(schedule.chatId, `⏱️ Reminder: ${reminder}`, schedule.platform);
      } else {
        const taskText = schedule.action.taskText ?? schedule.sourceText;
        const response = await this.orchestrator.handleMessage({
          platform: (schedule.platform as string === "website" || schedule.platform as string === "web") ? "web" : (schedule.platform as any),
          chatId: schedule.chatId,
          messageId: `schedule-${schedule.id}-${Date.now()}`,
          userId: schedule.ownerUserId,
          text: taskText,
          timestamp: new Date(),
          correlationId: randomUUID(),
          metadata: {
            scheduled: true,
            scheduleId: schedule.id,
            sourceMessageId: schedule.sourceMessageId,
          },
        } satisfies NormalizedMessage);

        runStatus = response.status === "error" ? "failed" : "success";
        resultSummary = response.text;
        if (response.status === "error") {
          errorSummary = response.text;
          await this.sender.sendResponse(
            schedule.chatId,
            `⚠️ Scheduled task failed (${schedule.action.title}): ${response.text}`,
            schedule.platform
          );
        } else {
          await this.sender.sendResponse(schedule.chatId, `⏱️ Scheduled task result:\n${response.text}`, schedule.platform);
        }
      }
    } catch (error) {
      runStatus = "failed";
      errorSummary = error instanceof Error ? error.message : String(error);
      resultSummary = errorSummary;
      try {
        await this.sender.sendResponse(
          schedule.chatId,
          `⚠️ Scheduled task failed (${schedule.action.title}): ${errorSummary}`,
          schedule.platform
        );
      } catch (sendError: any) {
        console.warn(`Failed to send error notification for schedule ${schedule.id}: ${sendError.message}`);
      }
    }

    const finishedAt = new Date();
    await this.repository.appendRun({
      id: randomUUID(),
      scheduleId: schedule.id,
      idempotencyKey,
      platform: schedule.platform,
      chatId: schedule.chatId,
      sourceMessageId: schedule.sourceMessageId,
      plannedAtIso: plannedAt.toISOString(),
      startedAtIso: startedAt.toISOString(),
      finishedAtIso: finishedAt.toISOString(),
      status: runStatus,
      resultSummary,
      errorSummary,
    });

    const latestSchedule = await this.repository.getScheduleById(schedule.id);
    if (!latestSchedule) {
      return;
    }

    if (latestSchedule.status === "cancelled" || latestSchedule.status === "paused") {
      return;
    }

    if (latestSchedule.status === "completed") {
      return;
    }

    const consecutiveFailures = runStatus === "failed" ? (latestSchedule.consecutiveFailures ?? 0) + 1 : 0;
    const runsCompleted = (latestSchedule.runsCompleted ?? 0) + (runStatus !== "failed" ? 1 : 0);
    const shouldAutoPause = consecutiveFailures >= FAILURE_AUTO_PAUSE_THRESHOLD;
    const shouldWarn = consecutiveFailures >= FAILURE_NOTIFY_THRESHOLD;

    // Check if bounded schedule (maxRuns) is complete
    const maxRunsReached = latestSchedule.pattern.maxRuns != null && runsCompleted >= latestSchedule.pattern.maxRuns;

    if (shouldWarn && runStatus === "failed") {
      try {
        await this.sender.sendResponse(
          latestSchedule.chatId,
          `⚠️ Schedule ${latestSchedule.id.slice(0, 8)} has failed ${consecutiveFailures} times in a row.`,
          latestSchedule.platform
        );
      } catch (sendError: any) {
        console.warn(`Failed to send failure warning for schedule ${latestSchedule.id}: ${sendError.message}`);
      }
    }

    if (maxRunsReached && !shouldAutoPause) {
      try {
        await this.sender.sendResponse(
          latestSchedule.chatId,
          `✅ Schedule "${latestSchedule.action.title}" completed all ${latestSchedule.pattern.maxRuns} runs.`,
          latestSchedule.platform
        );
      } catch (sendError: any) {
        console.warn(`Failed to send completion notification for schedule ${latestSchedule.id}: ${sendError.message}`);
      }
    }

    const nextStatus = shouldAutoPause
      ? "paused"
      : maxRunsReached
        ? "completed"
        : runStatus === "failed"
          ? "degraded"
          : latestSchedule.pattern.type === "once"
            ? "completed"
            : "active";

    await this.repository.updateSchedule({
      ...latestSchedule,
      status: nextStatus,
      lastRunAtIso: finishedAt.toISOString(),
      updatedAtIso: finishedAt.toISOString(),
      nextRunAtIso: undefined,
      consecutiveFailures,
      runsCompleted,
    });

    if (nextStatus === "active" || nextStatus === "degraded") {
      await this.arm(latestSchedule.id);
    }
  }
}

export const __internal = {
  isPrivateIpAddress,
  validateHttpPingTarget,
};
