export type ScheduleStatus = "active" | "paused" | "cancelled" | "degraded" | "completed";

export type ScheduleActionType = "agent_task" | "http_ping" | "reminder";

export type ScheduleRiskTier = "read_only" | "low_risk" | "significant" | "destructive";

export type SchedulePatternType = "once" | "interval" | "daily_times";

export interface ScheduleSourceContext {
  readonly platform: "telegram" | "slack" | "website";
  readonly chatId: string;
  readonly userId: string;
  readonly messageId: string;
  readonly originalText: string;
}

export interface SchedulePattern {
  readonly type: SchedulePatternType;
  readonly timezone: string;
  readonly runAtIso?: string;
  readonly intervalMinutes?: number;
  readonly intervalSeconds?: number;
  readonly timesOfDay?: readonly string[];
  /** Maximum number of runs before auto-completing (interval patterns). */
  readonly maxRuns?: number;
}

export interface ScheduleAction {
  readonly type: ScheduleActionType;
  readonly title: string;
  readonly taskText?: string;
  readonly url?: string;
  readonly method?: "GET";
  readonly reminderText?: string;
}

export interface ScheduleRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly platform: ScheduleSourceContext["platform"];
  readonly chatId: string;
  readonly sourceMessageId: string;
  readonly sourceText: string;
  readonly action: ScheduleAction;
  readonly pattern: SchedulePattern;
  readonly status: ScheduleStatus;
  readonly riskTier: ScheduleRiskTier;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  readonly lastRunAtIso?: string;
  readonly nextRunAtIso?: string;
  readonly consecutiveFailures: number;
  /** Number of completed runs — used with maxRuns to auto-complete interval schedules. */
  readonly runsCompleted: number;
}

export interface PendingScheduleDraft {
  readonly approvalToken: string;
  readonly createdAtIso: string;
  readonly expiresAtIso: string;
  readonly source: ScheduleSourceContext;
  readonly action: ScheduleAction;
  readonly pattern: SchedulePattern;
  readonly riskTier: ScheduleRiskTier;
}

export interface ScheduleRunRecord {
  readonly id: string;
  readonly scheduleId: string;
  readonly idempotencyKey: string;
  readonly platform: ScheduleSourceContext["platform"];
  readonly chatId: string;
  readonly sourceMessageId: string;
  readonly plannedAtIso: string;
  readonly startedAtIso: string;
  readonly finishedAtIso: string;
  readonly status: "success" | "failed" | "skipped_idempotent";
  readonly resultSummary?: string;
  readonly errorSummary?: string;
}

export interface ScheduleStoreDocument {
  readonly version: 1;
  readonly schedules: readonly ScheduleRecord[];
  readonly pendingDrafts: readonly PendingScheduleDraft[];
}

export interface ScheduleRunStoreDocument {
  readonly version: 1;
  readonly runs: readonly ScheduleRunRecord[];
}
