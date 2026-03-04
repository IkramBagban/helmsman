import type { ScheduleAction } from "./types.js";
import type { ScheduleRiskTier } from "./types.js";

// Safety-net regex — can only ESCALATE risk, never lower what the LLM says.
// Catches obvious destructive/significant keywords that the LLM might miss or be tricked into under-rating.
const DESTRUCTIVE_PATTERN = /\b(delete|remove|terminate|destroy|drop|wipe|purge|nuke|empty\s+bucket|rm\s+-rf)\b/i;
const SIGNIFICANT_PATTERN = /\b(stop|restart|reboot|scale|modify|update|create|deploy|shutdown|write|put|post)\b/i;

const RISK_RANK: Record<ScheduleRiskTier, number> = {
  read_only: 0,
  low_risk: 1,
  significant: 2,
  destructive: 3,
};

const RANK_TO_TIER: ScheduleRiskTier[] = ["read_only", "low_risk", "significant", "destructive"];

/**
 * Classify the risk of a scheduled action.
 *
 * Uses the LLM's riskHint as the primary signal (it understands natural language intent
 * far better than regex). A lightweight regex safety-net can only ESCALATE — never lower —
 * the risk tier, guarding against prompt injection or LLM mistakes.
 */
export const classifyScheduleRisk = (action: ScheduleAction, riskHint?: ScheduleRiskTier): ScheduleRiskTier => {
  // ── LLM hint (primary signal) ──────────────────────────────────────────
  const llmRisk = riskHint ?? inferBaselineRisk(action);

  // ── Regex safety-net (escalation only) ─────────────────────────────────
  const regexRisk = regexClassify(action);

  // Take the more conservative (higher) of the two
  const finalRank = Math.max(RISK_RANK[llmRisk], RISK_RANK[regexRisk]);
  return RANK_TO_TIER[finalRank] ?? "low_risk";
};

/** Fallback when no LLM hint is provided (e.g. old callers, tests). */
const inferBaselineRisk = (action: ScheduleAction): ScheduleRiskTier => {
  if (action.type === "reminder") return "read_only";
  if (action.type === "http_ping") return "low_risk";
  return "low_risk";
};

/** Pure regex classification — intentionally conservative keyword matching. */
const regexClassify = (action: ScheduleAction): ScheduleRiskTier => {
  if (action.type === "reminder") return "read_only";
  if (action.type === "http_ping") return "low_risk";

  const taskText = action.taskText ?? action.title;
  if (DESTRUCTIVE_PATTERN.test(taskText)) return "destructive";
  if (SIGNIFICANT_PATTERN.test(taskText)) return "significant";
  return "read_only"; // regex doesn't know → assume safe, let LLM hint decide
};

export const requiresApprovalForSchedule = (riskTier: ScheduleRiskTier): boolean => {
  return riskTier === "significant" || riskTier === "destructive";
};
