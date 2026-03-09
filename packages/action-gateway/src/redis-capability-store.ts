import type { Redis } from "ioredis";

import type {
  CapabilityRole,
  CapabilityStore,
  PendingActionRecord,
  PendingActivation,
  RoleState,
} from "./capability-store.js";

const ACTIVATION_TTL_SEC = 5 * 60;
const OPERATOR_TTL_MS = 30 * 60 * 1000;
const COMMANDER_TTL_MS = 15 * 60 * 1000;
const PENDING_ACTION_TTL_SEC = 10 * 60;

const activationKey = (role: CapabilityRole, id: string): string => `gate:activation:${role}:${id}`;
const roleKey = (userId: string, chatId: string): string => `gate:role:${userId}:${chatId}`;
const pendingActionKey = (id: string): string => `gate:pending:${id}`;
const pendingTargetKey = (userId: string, chatId: string, target: string): string =>
  `gate:pending-target:${userId}:${chatId}:${target}`;

const CONSUME_JSON_KEY_SCRIPT = `
  local value = redis.call("GET", KEYS[1])
  if not value then
    return nil
  end
  redis.call("DEL", KEYS[1])
  return value
`;

const CONSUME_PENDING_BY_TARGET_SCRIPT = `
  local indexKey = KEYS[1]
  local pendingPrefix = ARGV[1]

  local id = redis.call("GET", indexKey)
  if not id then
    return nil
  end

  local pendingKey = pendingPrefix .. id
  local payload = redis.call("GET", pendingKey)

  redis.call("DEL", indexKey)
  if payload then
    redis.call("DEL", pendingKey)
  end

  return payload
`;

const randomCode = (): string => crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();

const defaultRoleState = (userId: string, chatId: string): RoleState => ({
  userId,
  chatId,
  operator: { active: false },
  commander: { active: false },
});

export class RedisCapabilityStore implements CapabilityStore {
  public constructor(private readonly redis: Redis) {}

  private async consumeJsonKey(key: string): Promise<string | null> {
    const raw = await this.redis.eval(CONSUME_JSON_KEY_SCRIPT, 1, key);
    if (typeof raw !== "string") {
      return null;
    }

    return raw;
  }

  public async createActivation(input: {
    role: CapabilityRole;
    userId: string;
    chatId: string;
    nowMs?: number;
  }): Promise<PendingActivation> {
    const nowMs = input.nowMs ?? Date.now();
    const record: PendingActivation = {
      id: randomCode(),
      role: input.role,
      userId: input.userId,
      chatId: input.chatId,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + ACTIVATION_TTL_SEC * 1000,
    };

    await this.redis.set(
      activationKey(record.role, record.id),
      JSON.stringify(record),
      "EX",
      ACTIVATION_TTL_SEC,
    );

    return record;
  }

  public async consumeActivation(input: {
    role: CapabilityRole;
    activationId: string;
    userId: string;
    chatId: string;
    nowMs?: number;
  }): Promise<PendingActivation | null> {
    const key = activationKey(input.role, input.activationId.toUpperCase());
    const raw = await this.consumeJsonKey(key);
    if (!raw) {
      return null;
    }

    const record = JSON.parse(raw) as PendingActivation;
    if (record.userId !== input.userId || record.chatId !== input.chatId) {
      return null;
    }
    return record;
  }

  public async getRoleState(userId: string, chatId: string, nowMs: number = Date.now()): Promise<RoleState> {
    const raw = await this.redis.get(roleKey(userId, chatId));
    if (!raw) {
      return defaultRoleState(userId, chatId);
    }

    const state = JSON.parse(raw) as RoleState;
    const operatorActive = Boolean(state.operator.expiresAtMs && state.operator.expiresAtMs > nowMs);
    const commanderActive = Boolean(state.commander.expiresAtMs && state.commander.expiresAtMs > nowMs);

    return {
      ...state,
      operator: operatorActive ? state.operator : { active: false },
      commander: commanderActive ? state.commander : { active: false },
    };
  }

  public async activateRole(input: {
    role: CapabilityRole;
    userId: string;
    chatId: string;
    nowMs?: number;
  }): Promise<RoleState> {
    const nowMs = input.nowMs ?? Date.now();
    const current = await this.getRoleState(input.userId, input.chatId, nowMs);

    const next: RoleState = {
      userId: input.userId,
      chatId: input.chatId,
      operator: input.role === "operator"
        ? { active: true, activatedAtMs: nowMs, expiresAtMs: nowMs + OPERATOR_TTL_MS }
        : current.operator,
      commander: input.role === "commander"
        ? { active: true, activatedAtMs: nowMs, expiresAtMs: nowMs + COMMANDER_TTL_MS }
        : current.commander,
    };

    const maxExpiry = Math.max(next.operator.expiresAtMs ?? nowMs, next.commander.expiresAtMs ?? nowMs);
    const ttlSec = Math.max(1, Math.floor((maxExpiry - nowMs) / 1000));

    await this.redis.set(roleKey(input.userId, input.chatId), JSON.stringify(next), "EX", ttlSec);
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
    confirmationMode: "approve_code" | "confirm_target";
    confirmationTarget: string;
    nowMs?: number;
  }): Promise<PendingActionRecord> {
    const nowMs = input.nowMs ?? Date.now();
    const record: PendingActionRecord = {
      id: input.confirmationMode === "approve_code" ? input.confirmationTarget.toUpperCase() : randomCode(),
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
      expiresAtMs: nowMs + PENDING_ACTION_TTL_SEC * 1000,
    };

    await this.redis.set(pendingActionKey(record.id), JSON.stringify(record), "EX", PENDING_ACTION_TTL_SEC);

    if (record.confirmationMode === "confirm_target") {
      await this.redis.set(
        pendingTargetKey(record.userId, record.chatId, record.confirmationTarget),
        record.id,
        "EX",
        PENDING_ACTION_TTL_SEC,
      );
    }

    return record;
  }

  public async consumePendingActionByCode(lookup: {
    userId: string;
    chatId: string;
    value: string;
  }): Promise<PendingActionRecord | null> {
    const key = pendingActionKey(lookup.value.toUpperCase());
    const raw = await this.consumeJsonKey(key);
    if (!raw) {
      return null;
    }

    const record = JSON.parse(raw) as PendingActionRecord;
    if (record.userId !== lookup.userId || record.chatId !== lookup.chatId) {
      return null;
    }
    if (record.confirmationMode === "confirm_target") {
      await this.redis.del(pendingTargetKey(record.userId, record.chatId, record.confirmationTarget));
    }

    return record;
  }

  public async consumePendingActionByTarget(lookup: {
    userId: string;
    chatId: string;
    value: string;
  }): Promise<PendingActionRecord | null> {
    const index = pendingTargetKey(lookup.userId, lookup.chatId, lookup.value);
    const raw = await this.redis.eval(CONSUME_PENDING_BY_TARGET_SCRIPT, 1, index, "gate:pending:");
    if (!raw) {
      return null;
    }

    if (typeof raw !== "string") {
      return null;
    }

    const record = JSON.parse(raw) as PendingActionRecord;
    return record;
  }
}
