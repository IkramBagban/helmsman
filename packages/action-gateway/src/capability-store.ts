import { randomUUID } from "node:crypto";

export type CapabilityRole = "operator" | "commander";
export type ConfirmationMode = "approve_code" | "confirm_target";

export interface PendingActivation {
  readonly id: string;
  readonly role: CapabilityRole;
  readonly userId: string;
  readonly chatId: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export interface RoleState {
  readonly userId: string;
  readonly chatId: string;
  readonly operator: {
    readonly active: boolean;
    readonly activatedAtMs?: number;
    readonly expiresAtMs?: number;
  };
  readonly commander: {
    readonly active: boolean;
    readonly activatedAtMs?: number;
    readonly expiresAtMs?: number;
  };
}

export interface PendingActionRecord {
  readonly id: string;
  readonly role: CapabilityRole;
  readonly userId: string;
  readonly chatId: string;
  readonly runId: string;
  readonly riskTier: string;
  readonly description: string;
  readonly command: string;
  readonly confirmationMode: ConfirmationMode;
  readonly confirmationTarget: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export interface PendingActionLookup {
  readonly userId: string;
  readonly chatId: string;
  readonly value: string;
}

export interface CapabilityStore {
  createActivation(input: {
    role: CapabilityRole;
    userId: string;
    chatId: string;
    nowMs?: number;
  }): Promise<PendingActivation>;

  consumeActivation(input: {
    role: CapabilityRole;
    activationId: string;
    userId: string;
    chatId: string;
    nowMs?: number;
  }): Promise<PendingActivation | null>;

  getRoleState(userId: string, chatId: string, nowMs?: number): Promise<RoleState>;

  activateRole(input: {
    role: CapabilityRole;
    userId: string;
    chatId: string;
    nowMs?: number;
  }): Promise<RoleState>;

  createPendingAction(input: {
    role: CapabilityRole;
    userId: string;
    chatId: string;
    runId: string;
    riskTier: string;
    description: string;
    command: string;
    confirmationMode: ConfirmationMode;
    confirmationTarget: string;
    nowMs?: number;
  }): Promise<PendingActionRecord>;

  consumePendingActionByCode(lookup: PendingActionLookup): Promise<PendingActionRecord | null>;
  consumePendingActionByTarget(lookup: PendingActionLookup): Promise<PendingActionRecord | null>;
}

const DEFAULT_ACTIVATION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_OPERATOR_TTL_MS = 30 * 60 * 1000;
const DEFAULT_COMMANDER_TTL_MS = 15 * 60 * 1000;
const DEFAULT_PENDING_ACTION_TTL_MS = 10 * 60 * 1000;

const code = (): string => randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();

const defaultRoleState = (userId: string, chatId: string): RoleState => ({
  userId,
  chatId,
  operator: { active: false },
  commander: { active: false },
});

export class InMemoryCapabilityStore implements CapabilityStore {
  private readonly activations = new Map<string, PendingActivation>();
  private readonly roles = new Map<string, RoleState>();
  private readonly pendingActionsById = new Map<string, PendingActionRecord>();
  private readonly pendingActionIdByTarget = new Map<string, string>();

  private key(userId: string, chatId: string): string {
    return `${userId}:${chatId}`;
  }

  private cleanup(nowMs: number): void {
    for (const [key, activation] of this.activations.entries()) {
      if (activation.expiresAtMs <= nowMs) {
        this.activations.delete(key);
      }
    }

    for (const [key, state] of this.roles.entries()) {
      const operatorActive = Boolean(state.operator.expiresAtMs && state.operator.expiresAtMs > nowMs);
      const commanderActive = Boolean(state.commander.expiresAtMs && state.commander.expiresAtMs > nowMs);
      this.roles.set(key, {
        ...state,
        operator: operatorActive ? state.operator : { active: false },
        commander: commanderActive ? state.commander : { active: false },
      });
    }

    for (const [id, action] of this.pendingActionsById.entries()) {
      if (action.expiresAtMs <= nowMs) {
        this.pendingActionsById.delete(id);
        if (action.confirmationMode === "confirm_target") {
          this.pendingActionIdByTarget.delete(`${action.userId}:${action.chatId}:${action.confirmationTarget}`);
        }
      }
    }
  }

  public async createActivation(input: {
    role: CapabilityRole;
    userId: string;
    chatId: string;
    nowMs?: number;
  }): Promise<PendingActivation> {
    const nowMs = input.nowMs ?? Date.now();
    this.cleanup(nowMs);
    const record: PendingActivation = {
      id: code(),
      role: input.role,
      userId: input.userId,
      chatId: input.chatId,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + DEFAULT_ACTIVATION_TTL_MS,
    };
    this.activations.set(`${record.role}:${record.id}`, record);
    return record;
  }

  public async consumeActivation(input: {
    role: CapabilityRole;
    activationId: string;
    userId: string;
    chatId: string;
    nowMs?: number;
  }): Promise<PendingActivation | null> {
    const nowMs = input.nowMs ?? Date.now();
    this.cleanup(nowMs);
    const key = `${input.role}:${input.activationId.toUpperCase()}`;
    const record = this.activations.get(key);
    if (!record) {
      return null;
    }

    if (record.userId !== input.userId || record.chatId !== input.chatId) {
      return null;
    }

    this.activations.delete(key);
    return record;
  }

  public async getRoleState(userId: string, chatId: string, nowMs: number = Date.now()): Promise<RoleState> {
    this.cleanup(nowMs);
    const key = this.key(userId, chatId);
    return this.roles.get(key) ?? defaultRoleState(userId, chatId);
  }

  public async activateRole(input: {
    role: CapabilityRole;
    userId: string;
    chatId: string;
    nowMs?: number;
  }): Promise<RoleState> {
    const nowMs = input.nowMs ?? Date.now();
    const key = this.key(input.userId, input.chatId);
    const existing = await this.getRoleState(input.userId, input.chatId, nowMs);

    const operator = input.role === "operator"
      ? { active: true, activatedAtMs: nowMs, expiresAtMs: nowMs + DEFAULT_OPERATOR_TTL_MS }
      : existing.operator;
    const commander = input.role === "commander"
      ? { active: true, activatedAtMs: nowMs, expiresAtMs: nowMs + DEFAULT_COMMANDER_TTL_MS }
      : existing.commander;

    const next: RoleState = {
      userId: input.userId,
      chatId: input.chatId,
      operator,
      commander,
    };

    this.roles.set(key, next);
    return next;
  }

  public async createPendingAction(input: {
    role: CapabilityRole;
    userId: string;
    chatId: string;
    runId: string;
    riskTier: string;
    description: string;
    command: string;
    confirmationMode: ConfirmationMode;
    confirmationTarget: string;
    nowMs?: number;
  }): Promise<PendingActionRecord> {
    const nowMs = input.nowMs ?? Date.now();
    this.cleanup(nowMs);
    const record: PendingActionRecord = {
      id: code(),
      role: input.role,
      userId: input.userId,
      chatId: input.chatId,
      runId: input.runId,
      riskTier: input.riskTier,
      description: input.description,
      command: input.command,
      confirmationMode: input.confirmationMode,
      confirmationTarget: input.confirmationTarget,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + DEFAULT_PENDING_ACTION_TTL_MS,
    };

    this.pendingActionsById.set(record.id, record);
    if (record.confirmationMode === "confirm_target") {
      this.pendingActionIdByTarget.set(`${record.userId}:${record.chatId}:${record.confirmationTarget}`, record.id);
    }
    return record;
  }

  public async consumePendingActionByCode(lookup: PendingActionLookup): Promise<PendingActionRecord | null> {
    this.cleanup(Date.now());
    const record = this.pendingActionsById.get(lookup.value.toUpperCase());
    if (!record) {
      return null;
    }

    if (record.userId !== lookup.userId || record.chatId !== lookup.chatId) {
      return null;
    }

    this.pendingActionsById.delete(record.id);
    if (record.confirmationMode === "confirm_target") {
      this.pendingActionIdByTarget.delete(`${record.userId}:${record.chatId}:${record.confirmationTarget}`);
    }

    return record;
  }

  public async consumePendingActionByTarget(lookup: PendingActionLookup): Promise<PendingActionRecord | null> {
    this.cleanup(Date.now());
    const indexed = this.pendingActionIdByTarget.get(`${lookup.userId}:${lookup.chatId}:${lookup.value}`);
    if (!indexed) {
      return null;
    }

    const record = this.pendingActionsById.get(indexed);
    if (!record) {
      return null;
    }

    this.pendingActionsById.delete(record.id);
    this.pendingActionIdByTarget.delete(`${lookup.userId}:${lookup.chatId}:${lookup.value}`);
    return record;
  }
}
