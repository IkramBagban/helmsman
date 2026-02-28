export type Platform = "telegram" | "slack";

export interface NormalizedMessage {
  readonly platform: Platform;
  readonly chatId: string;
  readonly messageId: string;
  readonly userId: string;
  readonly text: string;
  readonly timestamp: Date;
  readonly correlationId: string;
  readonly replyToMessageId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface PlanStepSummary {
  readonly order: number;
  readonly description: string;
  readonly tool: string;
  readonly risk: string;
}

export interface PlanSummary {
  readonly id: string;
  readonly summary: string;
  readonly steps: readonly PlanStepSummary[];
  readonly riskTier: "read_only" | "low_risk" | "significant" | "destructive";
  readonly estimatedDuration?: string;
  readonly estimatedCost?: string;
}

export interface AgentResponse {
  readonly text: string;
  readonly status: "success" | "error" | "pending_approval";
  readonly correlationId: string;
  readonly plan?: PlanSummary;
  readonly metadata?: Record<string, unknown>;
}

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: {
    readonly message_id: number;
    readonly from: {
      readonly id: number;
      readonly first_name: string;
      readonly last_name?: string;
      readonly username?: string;
    };
    readonly chat: {
      readonly id: number;
      readonly type: "private" | "group" | "supergroup";
    };
    readonly date: number;
    readonly text?: string;
    readonly reply_to_message?: {
      readonly message_id: number;
    };
  };
}

export class AppError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;

  public constructor(code: string, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.context = context;
  }
}

export const isTelegramUpdate = (payload: unknown): payload is TelegramUpdate => {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const update = payload as { update_id?: unknown; message?: unknown };
  if (typeof update.update_id !== "number") {
    return false;
  }

  if (update.message === undefined) {
    return true;
  }

  if (typeof update.message !== "object" || update.message === null) {
    return false;
  }

  const message = update.message as {
    message_id?: unknown;
    from?: { id?: unknown; first_name?: unknown };
    chat?: { id?: unknown; type?: unknown };
    date?: unknown;
    text?: unknown;
    reply_to_message?: { message_id?: unknown };
  };

  const hasCoreFields =
    typeof message.message_id === "number" &&
    typeof message.from?.id === "number" &&
    typeof message.from?.first_name === "string" &&
    typeof message.chat?.id === "number" &&
    (message.chat?.type === "private" || message.chat?.type === "group" || message.chat?.type === "supergroup") &&
    typeof message.date === "number";

  if (!hasCoreFields) {
    return false;
  }

  if (message.text !== undefined && typeof message.text !== "string") {
    return false;
  }

  if (message.reply_to_message !== undefined && typeof message.reply_to_message?.message_id !== "number") {
    return false;
  }

  return true;
};
