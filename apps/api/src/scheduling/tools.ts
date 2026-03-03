/**
 * Mastra-wrapped scheduling tools.
 *
 * These tools let the LLM agent create, list, and manage scheduled tasks
 * via native function calling — no regex parser or manual intent detection.
 *
 * The tools are thin wrappers that validate input via Zod and delegate
 * to SchedulingService for all business logic (risk classification, approval
 * gates, engine arming, etc.).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import type { SchedulingService } from "./service.js";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const SchedulePatternSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("once"),
    timezone: z.string().default("UTC").describe("IANA timezone, e.g. 'America/New_York'. Default UTC."),
    runAtIso: z.string().optional().describe("ISO-8601 datetime for when to run. Provide either runAtIso OR delayMinutes, not both."),
    delayMinutes: z.number().positive().optional().describe("Run after this many minutes from now. Use for relative times like 'in 5 minutes', 'after 1 hour' (=60). The system computes the exact time."),
  }).refine(
    (data) => data.runAtIso ?? data.delayMinutes,
    { message: "Either runAtIso or delayMinutes is required for once patterns." },
  ),
  z.object({
    type: z.literal("interval"),
    timezone: z.string().default("UTC").describe("IANA timezone. Default UTC."),
    intervalMinutes: z.number().int().positive().describe("Repeat every N minutes."),
  }),
  z.object({
    type: z.literal("daily_times"),
    timezone: z.string().default("UTC").describe("IANA timezone. Default UTC."),
    timesOfDay: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1)
      .describe("Array of HH:MM times (24h format) to run each day."),
  }),
]);

const ScheduleActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent_task"),
    title: z.string().min(1).describe("Short title for the task."),
    taskText: z.string().min(1).describe("The full task description the agent should execute."),
  }),
  z.object({
    type: z.literal("reminder"),
    title: z.string().min(1).describe("Short title for the reminder."),
    reminderText: z.string().min(1).describe("The reminder message to send to the user."),
  }),
  z.object({
    type: z.literal("http_ping"),
    title: z.string().min(1).describe("Short title for the HTTP check."),
    url: z.string().url().describe("The URL to ping."),
    method: z.literal("GET").default("GET"),
  }),
]);

// ---------------------------------------------------------------------------
// Tool factory — needs a SchedulingService reference at runtime
// ---------------------------------------------------------------------------

export interface SchedulingToolsConfig {
  readonly schedulingService: SchedulingService;
}

/**
 * Create all scheduling Mastra tools.
 *
 * These are registered with the DevOps agent so the LLM can call them
 * via native function calling when users ask about scheduling.
 */
export function createSchedulingTools(config: SchedulingToolsConfig): Record<string, ReturnType<typeof createTool>> {
  const { schedulingService } = config;

  // ── create_schedule ─────────────────────────────────────────────────────
  const createScheduleTool = createTool({
    id: "create_schedule",
    description: `Create a new scheduled task, reminder, or HTTP ping.

Use this tool when the user wants to:
- Set a reminder ("remind me to X in 30 minutes")
- Schedule a recurring task ("check my EC2 instances every 6 hours")
- Schedule a one-time task ("deploy after 2 hours")
- Ping a URL on a schedule ("hit https://example.com every 5 minutes")
- Run something daily at specific times ("send me my AWS bill daily at 9am and 6pm")

Pattern types:
- "once": run once. Provide EITHER delayMinutes (for "in 5 minutes", "after 1 hour") OR runAtIso (for absolute times). Prefer delayMinutes for relative times.
- "interval": repeat every N minutes
- "daily_times": run at specific HH:MM times each day

Action types:
- "agent_task": Helmsman executes a task (e.g. "check billing", "list EC2 instances"). Use for anything involving data fetching, commands, or infrastructure.
- "reminder": send a text message to the user (e.g. "drink water", "standup time")
- "http_ping": GET request to a URL

You MUST pass chatId, userId, messageId, platform from the session metadata provided in the runtime context.`,
    inputSchema: z.object({
      action: ScheduleActionSchema,
      pattern: SchedulePatternSchema,
      platform: z.enum(["telegram", "slack"]).default("telegram"),
      chatId: z.string().describe("The chat ID where the schedule was requested."),
      userId: z.string().describe("The user ID who requested the schedule."),
      messageId: z.string().describe("The message ID of the request."),
      originalText: z.string().describe("The original user message text."),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
      scheduleId: z.string().optional(),
      requiresApproval: z.boolean().optional(),
      approvalToken: z.string().optional(),
    }),
    execute: async (input) => {
      try {
        // Resolve delayMinutes → runAtIso for "once" patterns
        let resolvedPattern = input.pattern;
        if (resolvedPattern.type === "once" && !resolvedPattern.runAtIso && resolvedPattern.delayMinutes) {
          const runAt = new Date(Date.now() + resolvedPattern.delayMinutes * 60_000);
          resolvedPattern = {
            type: "once" as const,
            timezone: resolvedPattern.timezone,
            runAtIso: runAt.toISOString(),
          };
        }

        const result = await schedulingService.createSchedule({
          source: {
            platform: input.platform,
            chatId: input.chatId,
            userId: input.userId,
            messageId: input.messageId,
            originalText: input.originalText,
          },
          action: input.action,
          pattern: resolvedPattern,
        });
        return result;
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : "Failed to create schedule.",
        };
      }
    },
  });

  // ── list_schedules ──────────────────────────────────────────────────────
  const listSchedulesTool = createTool({
    id: "list_schedules",
    description: `List the user's current schedules.

Use this when the user asks:
- "what schedules do I have"
- "list my schedules"
- "show my reminders"
- "what's scheduled"

Returns all schedules for the given user/chat, including status and next run time.`,
    inputSchema: z.object({
      userId: z.string().describe("The user ID to list schedules for."),
      chatId: z.string().describe("The chat ID to list schedules for."),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      schedules: z.array(z.object({
        id: z.string(),
        title: z.string(),
        actionType: z.string(),
        patternDescription: z.string(),
        status: z.string(),
        nextRunAt: z.string().optional(),
      })),
      message: z.string(),
    }),
    execute: async (input) => {
      try {
        const result = await schedulingService.listSchedules(input.userId, input.chatId);
        return result;
      } catch (error) {
        return {
          success: false,
          schedules: [],
          message: error instanceof Error ? error.message : "Failed to list schedules.",
        };
      }
    },
  });

  // ── manage_schedule ─────────────────────────────────────────────────────
  const manageScheduleTool = createTool({
    id: "manage_schedule",
    description: `Manage an existing schedule: pause, resume, cancel, or change its time.

Use this when the user asks to:
- "pause the billing check"
- "resume my reminder"
- "cancel all schedules"
- "change the daily report to 10am"
- "stop the EC2 check schedule"

For cancel_all, targetId is not required.
For change_time, provide the updated pattern.
For pause/resume/cancel, provide either a schedule ID prefix or the schedule title as targetId.`,
    inputSchema: z.object({
      action: z.enum(["pause", "resume", "cancel", "cancel_all", "change_time"])
        .describe("The management action to perform."),
      userId: z.string().describe("The user ID performing the action."),
      chatId: z.string().describe("The chat ID where the action was requested."),
      targetId: z.string().optional()
        .describe("Schedule ID prefix or title to identify which schedule. Not needed for cancel_all."),
      updatedPattern: SchedulePatternSchema.optional()
        .describe("New pattern for change_time action. Required when action is change_time."),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
    }),
    execute: async (input) => {
      try {
        const result = await schedulingService.manageSchedule({
          action: input.action,
          userId: input.userId,
          chatId: input.chatId,
          targetId: input.targetId,
          updatedPattern: input.updatedPattern,
        });
        return result;
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : "Failed to manage schedule.",
        };
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mastra tool types are covariant
  return {
    create_schedule: createScheduleTool,
    list_schedules: listSchedulesTool,
    manage_schedule: manageScheduleTool,
  } as Record<string, any>;
}
