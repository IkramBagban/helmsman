import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HelmsmanOrchestrator } from "@helmsman/agent-core";
import type { AgentResponse } from "@helmsman/shared";

import { SchedulingService, type ScheduleMessageSender } from "@helmsman/scheduling";


const tempDirs: string[] = [];

const createOrchestrator = (): HelmsmanOrchestrator =>
  ({
    handleMessage: async (): Promise<AgentResponse> => ({
      correlationId: "x",
      status: "success",
      text: "scheduled response",
    }),
    handleApproval: async (): Promise<AgentResponse> => ({
      correlationId: "x",
      status: "error",
      text: "not used",
    }),
    handleActivation: async (): Promise<AgentResponse> => ({
      correlationId: "x",
      status: "error",
      text: "not used",
    }),
    handleConfirmation: async (): Promise<AgentResponse> => ({
      correlationId: "x",
      status: "error",
      text: "not used",
    }),
  }) as unknown as HelmsmanOrchestrator;

const createSender = (): ScheduleMessageSender => ({
  sendTyping: async () => {},
  sendResponse: async () => {},
});

const makeService = async (): Promise<SchedulingService> => {
  const dataDir = await mkdtemp(join(tmpdir(), "helmsman-schedule-test-"));
  tempDirs.push(dataDir);

  const service = new SchedulingService({
    dataDir,
    sender: createSender(),
    orchestrator: createOrchestrator(),
    draftTtlMinutes: 15,
    runRetention: 20,
  });

  await service.start();
  return service;
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// createSchedule
// ---------------------------------------------------------------------------

describe("SchedulingService.createSchedule", () => {
  it("allows repeated start calls without reinitialization errors", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "helmsman-schedule-test-"));
    tempDirs.push(dataDir);

    const service = new SchedulingService({
      dataDir,
      sender: createSender(),
      orchestrator: createOrchestrator(),
      draftTtlMinutes: 15,
      runRetention: 20,
    });

    await service.start();
    await service.start();

    const result = await service.listSchedules("user-1", "chat-1");
    expect(result.success).toBe(true);
  });

  it("auto-creates low-risk schedules immediately", async () => {
    const service = await makeService();

    const result = await service.createSchedule({
      source: {
        platform: "telegram",
        chatId: "chat-1",
        userId: "user-1",
        messageId: "msg-1",
        originalText: "remind me to drink water every 30 minutes",
      },
      action: { type: "reminder", title: "drink water", reminderText: "Drink water!" },
      pattern: { type: "interval", intervalMinutes: 30, timezone: "UTC" },
    });

    expect(result.success).toBe(true);
    expect(result.scheduleId).toBeDefined();
    expect(result.requiresApproval).toBeUndefined();
    expect(result.message).toContain("Schedule created");
  });

  it("requires approval for destructive schedules", async () => {
    const service = await makeService();

    const result = await service.createSchedule({
      source: {
        platform: "telegram",
        chatId: "chat-1",
        userId: "user-1",
        messageId: "msg-2",
        originalText: "delete my aws bucket after 10 min",
      },
      action: { type: "agent_task", title: "delete aws bucket", taskText: "delete my aws s3 bucket" },
      pattern: { type: "once", runAtIso: new Date(Date.now() + 600_000).toISOString(), timezone: "UTC" },
    });

    expect(result.success).toBe(true);
    expect(result.requiresApproval).toBe(true);
    expect(result.approvalToken).toBeDefined();
    expect(result.message).toContain("/approve");
    expect(result.scheduleId).toBeUndefined();
  });

  it("approval token works via handleApproval", async () => {
    const service = await makeService();

    const createResult = await service.createSchedule({
      source: {
        platform: "telegram",
        chatId: "chat-1",
        userId: "user-1",
        messageId: "msg-3",
        originalText: "terminate EC2 instance every day at 1am",
      },
      action: { type: "agent_task", title: "terminate EC2", taskText: "terminate ec2 instance i-12345" },
      pattern: { type: "daily_times", timesOfDay: ["01:00"], timezone: "UTC" },
    });

    expect(createResult.approvalToken).toBeDefined();

    const approved = await service.handleApproval(
      createResult.approvalToken!,
      "user-1",
      "chat-1",
    );

    expect(approved).not.toBeNull();
    expect(approved).toContain("Schedule created");
  });

  it("rejects when per-user schedule limit is reached", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "helmsman-schedule-test-"));
    tempDirs.push(dataDir);

    const service = new SchedulingService({
      dataDir,
      sender: createSender(),
      orchestrator: createOrchestrator(),
      draftTtlMinutes: 15,
      runRetention: 20,
      maxSchedulesPerUser: 3,
    });
    await service.start();

    const makeSchedule = (index: number) =>
      service.createSchedule({
        source: {
          platform: "telegram",
          chatId: "chat-1",
          userId: "user-1",
          messageId: `msg-limit-${index}`,
          originalText: `reminder ${index}`,
        },
        action: { type: "reminder", title: `reminder ${index}`, reminderText: `Reminder ${index}` },
        pattern: { type: "once", runAtIso: new Date(Date.now() + 3_600_000).toISOString(), timezone: "UTC" },
      });

    const r1 = await makeSchedule(1);
    const r2 = await makeSchedule(2);
    const r3 = await makeSchedule(3);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r3.success).toBe(true);

    const r4 = await makeSchedule(4);
    expect(r4.success).toBe(false);
    expect(r4.message).toContain("maximum");
    expect(r4.message).toContain("3");
  });
});

// ---------------------------------------------------------------------------
// listSchedules
// ---------------------------------------------------------------------------

describe("SchedulingService.listSchedules", () => {
  it("returns empty list when no schedules exist", async () => {
    const service = await makeService();

    const result = await service.listSchedules("user-1", "chat-1");
    expect(result.success).toBe(true);
    expect(result.schedules).toHaveLength(0);
    expect(result.message).toContain("No active schedules");
  });

  it("lists created schedules", async () => {
    const service = await makeService();

    await service.createSchedule({
      source: {
        platform: "telegram",
        chatId: "chat-1",
        userId: "user-1",
        messageId: "msg-4",
        originalText: "remind me to stand up every 60 minutes",
      },
      action: { type: "reminder", title: "stand up", reminderText: "Time to stand up!" },
      pattern: { type: "interval", intervalMinutes: 60, timezone: "UTC" },
    });

    const result = await service.listSchedules("user-1", "chat-1");
    expect(result.success).toBe(true);
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0]!.title).toBe("stand up");
    expect(result.schedules[0]!.status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// manageSchedule
// ---------------------------------------------------------------------------

describe("SchedulingService.manageSchedule", () => {
  it("pauses and resumes a schedule", async () => {
    const service = await makeService();

    const createResult = await service.createSchedule({
      source: {
        platform: "telegram",
        chatId: "chat-1",
        userId: "user-1",
        messageId: "msg-5",
        originalText: "ping my server every 5 minutes",
      },
      action: { type: "http_ping", title: "ping server", url: "https://example.com/health", method: "GET" },
      pattern: { type: "interval", intervalMinutes: 5, timezone: "UTC" },
    });

    const scheduleId = createResult.scheduleId!;
    const idPrefix = scheduleId.slice(0, 8);

    const pauseResult = await service.manageSchedule({
      action: "pause",
      userId: "user-1",
      chatId: "chat-1",
      targetId: idPrefix,
    });
    expect(pauseResult.success).toBe(true);
    expect(pauseResult.message).toContain("Paused");

    const resumeResult = await service.manageSchedule({
      action: "resume",
      userId: "user-1",
      chatId: "chat-1",
      targetId: idPrefix,
    });
    expect(resumeResult.success).toBe(true);
    expect(resumeResult.message).toContain("Resumed");
  });

  it("cancels a schedule", async () => {
    const service = await makeService();

    const createResult = await service.createSchedule({
      source: {
        platform: "telegram",
        chatId: "chat-1",
        userId: "user-1",
        messageId: "msg-6",
        originalText: "check disk space every hour",
      },
      action: { type: "agent_task", title: "check disk space", taskText: "check disk space on prod" },
      pattern: { type: "interval", intervalMinutes: 60, timezone: "UTC" },
    });

    const cancelResult = await service.manageSchedule({
      action: "cancel",
      userId: "user-1",
      chatId: "chat-1",
      targetId: createResult.scheduleId!.slice(0, 8),
    });
    expect(cancelResult.success).toBe(true);
    expect(cancelResult.message).toContain("Cancelled");

    const list = await service.listSchedules("user-1", "chat-1");
    const activeCount = list.schedules.filter((s) => s.status === "active").length;
    expect(activeCount).toBe(0);
  });

  it("cancel_all removes all schedules", async () => {
    const service = await makeService();

    await service.createSchedule({
      source: {
        platform: "telegram",
        chatId: "chat-1",
        userId: "user-1",
        messageId: "msg-7",
        originalText: "reminder every 10 minutes",
      },
      action: { type: "reminder", title: "reminder 1", reminderText: "Hello" },
      pattern: { type: "interval", intervalMinutes: 10, timezone: "UTC" },
    });

    await service.createSchedule({
      source: {
        platform: "telegram",
        chatId: "chat-1",
        userId: "user-1",
        messageId: "msg-8",
        originalText: "reminder every 20 minutes",
      },
      action: { type: "reminder", title: "reminder 2", reminderText: "World" },
      pattern: { type: "interval", intervalMinutes: 20, timezone: "UTC" },
    });

    const cancelAllResult = await service.manageSchedule({
      action: "cancel_all",
      userId: "user-1",
      chatId: "chat-1",
    });
    expect(cancelAllResult.success).toBe(true);
    expect(cancelAllResult.message).toContain("2");
  });

  it("returns error when targetId missing for non-cancel_all actions", async () => {
    const service = await makeService();

    const result = await service.manageSchedule({
      action: "pause",
      userId: "user-1",
      chatId: "chat-1",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("specify");
  });

  it("returns error when target schedule not found", async () => {
    const service = await makeService();

    const result = await service.manageSchedule({
      action: "cancel",
      userId: "user-1",
      chatId: "chat-1",
      targetId: "nonexistent",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("No matching");
  });
});
