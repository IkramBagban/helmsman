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
    runAtIso: z.string().datetime().optional().describe("ISO-8601 datetime for when to run. Provide either runAtIso OR delayMinutes OR delaySeconds."),
    delayMinutes: z.number().positive().optional().describe("Run after this many minutes from now. Use for relative times >= 1 minute like 'in 5 minutes', 'after 1 hour' (=60)."),
    delaySeconds: z.number().int().positive().optional().describe("Run after this many seconds from now. Use for sub-minute delays like 'after 30 seconds', 'in 10 sec'. Minimum: 5."),
  }).refine(
    (data) => data.runAtIso ?? data.delayMinutes ?? data.delaySeconds,
    { message: "Provide one of: runAtIso, delayMinutes, or delaySeconds for once patterns." },
  ),
  z.object({
    type: z.literal("interval"),
    timezone: z.string().default("UTC").describe("IANA timezone. Default UTC."),
    intervalMinutes: z.number().int().positive().optional().describe("Repeat every N minutes. Use for intervals >= 1 minute."),
    intervalSeconds: z.number().int().min(5).optional().describe("Repeat every N seconds. Use for sub-minute intervals like 'every 10 seconds'. Minimum: 5."),
    maxRuns: z.number().int().positive().optional().describe("Stop after this many runs. Use when the user specifies a bounded duration like 'for 1 minute', 'for 5 times', 'till 10 minutes'."),
  }).refine(
    (data) => data.intervalMinutes ?? data.intervalSeconds,
    { message: "Provide either intervalMinutes or intervalSeconds for interval patterns." },
  ),
  z.object({
    type: z.literal("daily_times"),
    timezone: z.string().default("UTC").describe("IANA timezone. Default UTC."),
    timesOfDay: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1)
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
- "once": run once. Provide EITHER delayMinutes (>= 1 min), delaySeconds (for sub-minute like "after 30 sec"), OR runAtIso (absolute times). Prefer delayMinutes/delaySeconds for relative times.
- "interval": repeat on an interval. Use intervalMinutes (>= 1 min) or intervalSeconds (for sub-minute like "every 10 sec"). Add maxRuns when user specifies a bounded duration ("for 1 minute" at 10s interval = maxRuns 6).
- "daily_times": run at specific HH:MM times each day

Action types:
- "agent_task": Helmsman executes a task (e.g. "check billing", "list EC2 instances"). Use for anything involving data fetching, commands, or infrastructure.
- "reminder": send a text message to the user (e.g. "drink water", "standup time")
- "http_ping": GET request to a URL

You MUST pass chatId, userId, messageId, platform from the session metadata provided in the runtime context.

Risk assessment — you MUST set riskHint:
- "read_only": no side effects (reminders, reading data, listing resources)
- "low_risk": minor side effects (HTTP pings, non-destructive checks)
- "significant": modifies infrastructure (create, deploy, restart, scale, stop, update)
- "destructive": deletes, removes, terminates, or wipes resources`,
    inputSchema: z.object({
      action: ScheduleActionSchema,
      pattern: SchedulePatternSchema,
      riskHint: z.enum(["read_only", "low_risk", "significant", "destructive"])
        .describe("Your assessment of how risky this scheduled action is. read_only=no side effects, low_risk=minor, significant=infra changes, destructive=deletes/removes/terminates."),
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
        // ── Pre-flight semantic validation with LLM-friendly error messages ──
        let resolvedPattern = input.pattern;

        if (resolvedPattern.type === "once") {
          // Auto-resolve: if multiple timing fields given, pick by priority
          // runAtIso (most explicit) > delayMinutes (common) > delaySeconds (sub-minute)
          if (resolvedPattern.runAtIso) {
            // Absolute time wins — clear delay fields
            resolvedPattern = { ...resolvedPattern, delayMinutes: undefined, delaySeconds: undefined };
          } else if (resolvedPattern.delayMinutes && resolvedPattern.delaySeconds) {
            // Both delays provided — use delayMinutes (larger granularity, likely intentional)
            resolvedPattern = { ...resolvedPattern, delaySeconds: undefined };
          }

          // Convert delay → absolute runAtIso
          if (!resolvedPattern.runAtIso) {
            let delayMs = 0;
            if (resolvedPattern.delayMinutes) {
              delayMs = resolvedPattern.delayMinutes * 60_000;
            } else if (resolvedPattern.delaySeconds) {
              if (resolvedPattern.delaySeconds < 5) {
                return { success: false, message: "delaySeconds must be at least 5. Try delaySeconds: 5 or higher." };
              }
              delayMs = resolvedPattern.delaySeconds * 1_000;
            }
            if (delayMs > 0) {
              const runAt = new Date(Date.now() + delayMs);
              resolvedPattern = {
                type: "once" as const,
                timezone: resolvedPattern.timezone,
                runAtIso: runAt.toISOString(),
              };
            } else {
              return { success: false, message: "Once pattern needs a time: provide runAtIso (ISO-8601), delayMinutes, or delaySeconds." };
            }
          }
        }

        if (resolvedPattern.type === "interval") {
          // Auto-resolve: if both interval fields given, prefer intervalSeconds (more specific)
          if (resolvedPattern.intervalMinutes && resolvedPattern.intervalSeconds) {
            resolvedPattern = { ...resolvedPattern, intervalMinutes: undefined };
          }

          if (!resolvedPattern.intervalMinutes && !resolvedPattern.intervalSeconds) {
            return { success: false, message: "Interval pattern needs either intervalMinutes or intervalSeconds." };
          }

          if (resolvedPattern.intervalSeconds != null && resolvedPattern.intervalSeconds < 5) {
            return { success: false, message: "intervalSeconds must be at least 5. Try intervalSeconds: 5 or higher." };
          }

          // Normalize the pattern for the engine
          if (!resolvedPattern.intervalMinutes && resolvedPattern.intervalSeconds) {
            resolvedPattern = {
              type: "interval" as const,
              timezone: resolvedPattern.timezone,
              intervalSeconds: resolvedPattern.intervalSeconds,
              maxRuns: resolvedPattern.maxRuns,
            };
          }
        }

        if (resolvedPattern.type === "daily_times") {
          if (!resolvedPattern.timesOfDay || resolvedPattern.timesOfDay.length === 0) {
            return { success: false, message: "daily_times pattern needs at least one time in timesOfDay array (HH:MM format, 24h)." };
          }
        }

        // ── Validate action fields ──
        if (input.action.type === "http_ping" && "url" in input.action) {
          try {
            new URL(input.action.url);
          } catch {
            return { success: false, message: `Invalid URL: "${input.action.url}". Provide a valid URL starting with https://.` };
          }
        }

        const result = await schedulingService.createSchedule({
          riskHint: input.riskHint,
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
        const msg = error instanceof Error ? error.message : "Failed to create schedule.";
        return {
          success: false,
          message: `Schedule creation failed: ${msg}. Check the pattern and action fields, then retry.`,
        };
      }
    },
  });

  // ── list_schedules ──────────────────────────────────────────────────────
  const listSchedulesTool = createTool({
    id: "list_schedules",
    description: `List schedules for the user.

Use this when the user asks:
- "what schedules do I have"
- "list my schedules / cron jobs"
- "show my reminders"
- "what's scheduled"

By default, it only shows 'active' schedules (including paused/degraded). Set statusFilter to 'all' to include cancelled/completed jobs.`,
    inputSchema: z.object({
      userId: z.string().describe("The user ID to list schedules for."),
      chatId: z.string().describe("The chat ID to list schedules for."),
      statusFilter: z.enum(["active", "terminal", "all"]).default("active")
        .describe("Filter by status. 'active' (default) hides cancelled/completed. 'terminal' only shows cancelled/completed. 'all' shows everything."),
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
        lastRunAt: z.string().optional(),
        runsCompleted: z.number(),
      })),
      message: z.string(),
    }),
    execute: async (input) => {
      try {
        const result = await schedulingService.listSchedules(input.userId, input.chatId, input.statusFilter);
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

  // ── get_schedule_runs ───────────────────────────────────────────────────
  const getScheduleRunsTool = createTool({
    id: "get_schedule_runs",
    description: `Get the run history for a specific schedule.

Use this when the user asks:
- "show me the last runs for the billing check"
- "what happened with my daily report?"
- "did the health check run successfully?"

Provide either a schedule ID prefix or the schedule title as targetId.`,
    inputSchema: z.object({
      userId: z.string().describe("The user ID."),
      chatId: z.string().describe("The chat ID."),
      targetId: z.string().describe("Schedule ID prefix or title."),
      limit: z.number().int().positive().max(50).default(10).describe("Max runs to return."),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      runs: z.array(z.object({
        status: z.string(),
        startedAt: z.string(),
        finishedAt: z.string(),
        summary: z.string().optional(),
      })),
      message: z.string(),
    }),
    execute: async (input) => {
      try {
        return await schedulingService.getScheduleRuns(input.targetId, input.userId, input.chatId, input.limit);
      } catch (error) {
        return {
          success: false,
          runs: [],
          message: error instanceof Error ? error.message : "Failed to get run history.",
        };
      }
    },
  });

  // ── manage_schedule ─────────────────────────────────────────────────────
  const manageScheduleTool = createTool({
    id: "manage_schedule",
    description: `Manage an existing schedule: pause, resume, cancel, change its time, delete, or run it immediately.

Use this when the user asks to:
- "pause the billing check" (stop)
- "resume my reminder" (start)
- "run the daily report now" (trigger manually)
- "cancel all schedules"
- "change the daily report to 10am"

For cancel_all, targetId is not required.
For change_time, provide the updated pattern.
For pause/resume/cancel/delete/run, provide either a schedule ID prefix or the schedule title as targetId.`,
    inputSchema: z.object({
      action: z.enum(["pause", "resume", "cancel", "cancel_all", "change_time", "delete", "run"])
        .describe("The management action to perform. 'pause' = stop, 'resume' = start, 'run' = manual trigger, 'delete' = absolute removal."),
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
    get_schedule_runs: getScheduleRunsTool,
    manage_schedule: manageScheduleTool,
  } as Record<string, any>;
}
