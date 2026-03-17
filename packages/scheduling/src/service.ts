import type { HelmsmanOrchestrator } from "@helmsman/agent-core";

import type { ScheduleMessageSender } from "./sender.js";
import { SchedulerEngine } from "./engine.js";
import { classifyScheduleRisk, requiresApprovalForSchedule } from "./risk.js";
import { JsonScheduleRepository } from "./store.js";
import type {
  ScheduleAction,
  SchedulePattern,
  ScheduleRecord,
  ScheduleRiskTier,
  ScheduleSourceContext,
} from "./types.js";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const formatPattern = (pattern: SchedulePattern): string => {
  if (pattern.type === "once") {
    return pattern.runAtIso ? `once at ${pattern.runAtIso}` : "once (unknown time)";
  }
  if (pattern.type === "interval") {
    const intervalLabel = pattern.intervalSeconds
      ? `every ${pattern.intervalSeconds} second(s)`
      : `every ${pattern.intervalMinutes ?? 0} minute(s)`;
    const boundLabel = pattern.maxRuns ? ` (max ${pattern.maxRuns} runs)` : "";
    return `${intervalLabel}${boundLabel}`;
  }
  return `daily at ${(pattern.timesOfDay ?? []).join(", ")} (${pattern.timezone})`;
};

const resolveByTarget = (schedules: readonly ScheduleRecord[], targetText: string): ScheduleRecord | null => {
  // Strip leading # or @ common in natural language references
  const target = targetText.trim().toLowerCase().replace(/^[#@]/, "");
  
  const byId = schedules.find((item) => item.id.toLowerCase().startsWith(target));
  if (byId) {
    return byId;
  }
  return schedules.find((item) =>
    item.action.title.toLowerCase().includes(target)
    || item.sourceText.toLowerCase().includes(target),
  ) ?? null;
};

// ---------------------------------------------------------------------------
// Tool-facing input/output types
// ---------------------------------------------------------------------------

export interface CreateScheduleInput {
  readonly source: ScheduleSourceContext;
  readonly action: ScheduleAction;
  readonly pattern: SchedulePattern;
  /** LLM-provided risk assessment — used as primary signal, regex as safety-net. */
  readonly riskHint?: ScheduleRiskTier;
}

export interface CreateScheduleResult {
  readonly success: boolean;
  readonly message: string;
  readonly scheduleId?: string;
  readonly requiresApproval?: boolean;
  readonly approvalToken?: string;
}

export interface ListSchedulesResult {
  readonly success: boolean;
  readonly schedules: readonly {
    id: string;
    title: string;
    actionType: string;
    patternDescription: string;
    status: string;
    nextRunAt?: string;
    lastRunAt?: string;
    runsCompleted: number;
  }[];
  readonly message: string;
}

export interface ManageScheduleInput {
  readonly action: "pause" | "resume" | "cancel" | "cancel_all" | "change_time" | "delete" | "run";
  readonly userId: string;
  readonly chatId: string;
  readonly targetId?: string;
  readonly updatedPattern?: SchedulePattern;
}

export interface ManageScheduleResult {
  readonly success: boolean;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Service config & implementation
// ---------------------------------------------------------------------------

export interface SchedulingServiceConfig {
  readonly dataDir: string;
  readonly sender: ScheduleMessageSender;
  readonly orchestrator: HelmsmanOrchestrator;
  readonly draftTtlMinutes?: number;
  readonly runRetention?: number;
  /** Maximum active schedules per user per chat. Defaults to 25. */
  readonly maxSchedulesPerUser?: number;
}

export class SchedulingService {
  private readonly repository: JsonScheduleRepository;
  private readonly engine: SchedulerEngine;
  private readonly draftTtlMinutes: number;
  private readonly maxSchedulesPerUser: number;
  private startPromise: Promise<void> | null = null;

  public constructor(config: SchedulingServiceConfig) {
    this.repository = new JsonScheduleRepository({
      dataDir: config.dataDir,
      runRetention: config.runRetention ?? 500,
    });
    this.engine = new SchedulerEngine({
      repository: this.repository,
      sender: config.sender,
      orchestrator: config.orchestrator,
    });
    this.draftTtlMinutes = config.draftTtlMinutes ?? 15;
    this.maxSchedulesPerUser = config.maxSchedulesPerUser ?? 25;
  }

  public async start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = (async () => {
        await this.repository.initialize();
        await this.engine.start();
      })();
    }
    await this.startPromise;
  }

  public stop(): void {
    this.engine.stop();
  }

  // ── Approval flow (still used by /approve command in telegram route) ────
  public async handleApproval(token: string, userId: string, chatId: string): Promise<string | null> {
    const draft = await this.repository.consumePendingDraft(token, userId, chatId);
    if (!draft) {
      return null;
    }

    const schedule = await this.repository.createScheduleFromDraft(draft);
    await this.engine.arm(schedule.id);
    const refreshed = await this.repository.getScheduleById(schedule.id);

    return [
      `Schedule created (${schedule.id.slice(0, 8)}).`,
      `Action: ${schedule.action.title}`,
      `Pattern: ${formatPattern(schedule.pattern)}`,
      `Risk tier: ${schedule.riskTier}`,
      refreshed?.nextRunAtIso ? `Next run: ${refreshed.nextRunAtIso}` : "",
    ].filter(Boolean).join("\n");
  }

  // ── Tool-facing methods ─────────────────────────────────────────────────

  /**
   * Create a schedule. If the action is risky, returns requiresApproval=true
   * with an approval token instead of auto-creating.
   */
  public async createSchedule(input: CreateScheduleInput): Promise<CreateScheduleResult> {
    const riskTier = classifyScheduleRisk(input.action, input.riskHint);

    // ── Per-user schedule limit ──────────────────────────────────────
    const existing = await this.repository.listSchedulesByOwner(input.source.userId, input.source.chatId);
    const activeCount = existing.filter((s) => s.status === "active" || s.status === "degraded").length;
    if (activeCount >= this.maxSchedulesPerUser) {
      return {
        success: false,
        message: `You have reached the maximum of ${this.maxSchedulesPerUser} active schedules. Cancel some existing schedules first.`,
      };
    }

    if (requiresApprovalForSchedule(riskTier)) {
      const draft = await this.repository.createPendingDraft({
        source: input.source,
        action: input.action,
        pattern: input.pattern,
        riskTier,
        ttlMinutes: this.draftTtlMinutes,
      });

      return {
        success: true,
        message: [
          `This action is classified as ${riskTier} risk and requires approval before scheduling.`,
          `Action: ${input.action.title}`,
          `Pattern: ${formatPattern(input.pattern)}`,
          `The user must reply with: /approve ${draft.approvalToken}`,
        ].join("\n"),
        requiresApproval: true,
        approvalToken: draft.approvalToken,
      };
    }

    // Auto-approved — create immediately
    const schedule = await this.repository.createScheduleFromDraft({
      approvalToken: "AUTO",
      createdAtIso: new Date().toISOString(),
      expiresAtIso: new Date(Date.now() + this.draftTtlMinutes * 60_000).toISOString(),
      source: input.source,
      action: input.action,
      pattern: input.pattern,
      riskTier,
    });

    await this.engine.arm(schedule.id);
    const refreshed = await this.repository.getScheduleById(schedule.id);

    return {
      success: true,
      message: [
        `Schedule created (${schedule.id.slice(0, 8)}).`,
        `Action: ${input.action.title}`,
        `Pattern: ${formatPattern(input.pattern)}`,
        refreshed?.nextRunAtIso ? `Next run: ${refreshed.nextRunAtIso}` : "",
      ].filter(Boolean).join("\n"),
      scheduleId: schedule.id,
    };
  }

  /**
   * List schedules for a user/chat.
   */
  public async listSchedules(
    userId: string,
    chatId: string,
    statusFilter: "active" | "all" | "terminal" = "active"
  ): Promise<ListSchedulesResult> {
    const all = await this.repository.listSchedulesByOwner(userId, chatId);
    
    let schedules = all;
    if (statusFilter === "active") {
      schedules = all.filter((s) => s.status !== "cancelled" && s.status !== "completed");
    } else if (statusFilter === "terminal") {
      schedules = all.filter((s) => s.status === "cancelled" || s.status === "completed");
    }

    if (schedules.length === 0) {
      const msg = statusFilter === "active" ? "No active schedules found." :
                 statusFilter === "terminal" ? "No cancelled or completed schedules found." :
                 "No schedules found.";
      return { success: true, schedules: [], message: msg };
    }

    return {
      success: true,
      schedules: schedules.map((item) => ({
        id: item.id.slice(0, 8),
        title: item.action.title,
        actionType: item.action.type,
        patternDescription: formatPattern(item.pattern),
        status: item.status,
        nextRunAt: item.nextRunAtIso,
        lastRunAt: item.lastRunAtIso,
        runsCompleted: item.runsCompleted,
      })),
      message: `Found ${schedules.length} schedule(s).`,
    };
  }

  /**
   * Manage an existing schedule: pause, resume, cancel, cancel_all, change_time.
   */
  public async manageSchedule(input: ManageScheduleInput): Promise<ManageScheduleResult> {
    const schedules = await this.repository.listSchedulesByOwner(input.userId, input.chatId);

    if (input.action === "cancel_all") {
      const cancellable = schedules.filter((s) =>
        s.status === "active" || s.status === "degraded" || s.status === "paused"
      );
      if (cancellable.length === 0) {
        return { success: true, message: "No active schedules to cancel." };
      }
      for (const item of cancellable) {
        await this.engine.cancel(item.id);
      }
      return { success: true, message: `Cancelled ${cancellable.length} schedule(s).` };
    }

    if (!input.targetId) {
      return { success: false, message: "Please specify which schedule (ID prefix or title)." };
    }

    const target = resolveByTarget(schedules, input.targetId);
    if (!target) {
      return { success: false, message: "No matching schedule found for that ID or title." };
    }

    if (input.action === "pause") {
      await this.engine.pause(target.id);
      return { success: true, message: `Paused schedule ${target.id.slice(0, 8)} (${target.action.title}).` };
    }

    if (input.action === "resume") {
      if (target.status === "active") {
        return { success: true, message: `Schedule ${target.id.slice(0, 8)} (${target.action.title}) is already active.` };
      }
      const resumed = await this.engine.resume(target.id);
      if (!resumed) {
        return { success: false, message: `Could not resume schedule ${target.id.slice(0, 8)}.` };
      }
      return { success: true, message: `Resumed schedule ${target.id.slice(0, 8)} (${target.action.title}).` };
    }

    if (input.action === "cancel") {
      await this.engine.cancel(target.id);
      return { success: true, message: `Cancelled schedule ${target.id.slice(0, 8)} (${target.action.title}).` };
    }

    if (input.action === "change_time") {
      if (!input.updatedPattern) {
        return { success: false, message: "Updated pattern is required for change_time." };
      }

      await this.repository.updateSchedule({
        ...target,
        pattern: input.updatedPattern,
        status: "active",
        updatedAtIso: new Date().toISOString(),
        consecutiveFailures: 0,
      });
      await this.engine.arm(target.id);
      return {
        success: true,
        message: `Updated schedule ${target.id.slice(0, 8)} to ${formatPattern(input.updatedPattern)}.`,
      };
    }

    if (input.action === "delete") {
      await this.engine.delete(target.id);
      return { success: true, message: `Deleted schedule ${target.id.slice(0, 8)} (${target.action.title}).` };
    }

    if (input.action === "run") {
      this.engine.runNow(target.id).catch(console.error);
      return { success: true, message: `Triggered manual run for schedule ${target.id.slice(0, 8)} (${target.action.title}).` };
    }

    return { success: false, message: "Unsupported schedule action." };
  }

  public async getScheduleRuns(scheduleId: string, userId: string, chatId: string, limit: number = 10): Promise<{
    success: boolean;
    runs: readonly { status: string; startedAt: string; finishedAt: string; summary?: string }[];
    message: string;
  }> {
    const schedules = await this.repository.listSchedulesByOwner(userId, chatId);
    const target = resolveByTarget(schedules, scheduleId);
    if (!target) {
      return { success: false, runs: [], message: "No matching schedule found." };
    }

    const runs = await this.repository.listRuns(target.id, limit);
    return {
      success: true,
      runs: runs.map((r) => ({
        status: r.status,
        startedAt: r.startedAtIso,
        finishedAt: r.finishedAtIso,
        summary: r.resultSummary,
      })),
      message: runs.length > 0 ? `Found ${runs.length} run(s).` : "No runs yet.",
    };
  }
}
