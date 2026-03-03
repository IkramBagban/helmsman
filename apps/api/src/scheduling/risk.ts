import type { ScheduleAction } from "./types.js";
import type { ScheduleRiskTier } from "./types.js";

const DESTRUCTIVE_PATTERN = /\b(delete|remove|terminate|destroy|drop|wipe|purge|nuke|empty\s+bucket)\b/i;
const SIGNIFICANT_PATTERN = /\b(stop|restart|reboot|scale|modify|update|create|deploy|shutdown)\b/i;

export const classifyScheduleRisk = (action: ScheduleAction): ScheduleRiskTier => {
  if (action.type === "reminder") {
    return "read_only";
  }

  if (action.type === "http_ping") {
    return "low_risk";
  }

  const taskText = action.taskText ?? action.title;
  if (DESTRUCTIVE_PATTERN.test(taskText)) {
    return "destructive";
  }

  if (SIGNIFICANT_PATTERN.test(taskText)) {
    return "significant";
  }

  return "low_risk";
};

export const requiresApprovalForSchedule = (riskTier: ScheduleRiskTier): boolean => {
  return riskTier === "significant" || riskTier === "destructive";
};
