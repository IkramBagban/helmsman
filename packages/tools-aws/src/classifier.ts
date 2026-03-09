const READ_ONLY_VERBS = [
  "describe", "list", "get", "check", "preview",
  "estimate", "simulate", "validate", "test",
  "scan", "search", "query", "show", "view"
];

const DESTRUCTIVE_VERBS = [
  "delete", "terminate", "destroy", "remove", "purge",
  "wipe", "drop", "empty", "deregister"
];

const DESTRUCTIVE_SPECIAL_CASES = [
  "aws s3 rb ",
  "aws s3 rm ",
  "aws ec2 cancel-spot-instance-requests"
];

const DESTRUCTIVE_FLAGS = [
  "--force",
  "--delete"
];

export type CommandTier = "read" | "operator" | "commander" | "unknown";

export function classifyAWSCommand(command: string): CommandTier {
  const normalized = command.trim().toLowerCase();

  if (!normalized.startsWith("aws ")) return "unknown";

  // Layer 1: special case exact matches
  if (DESTRUCTIVE_SPECIAL_CASES.some(s => normalized.startsWith(s))) {
    return "commander";
  }

  // Layer 2: destructive flags
  if (DESTRUCTIVE_FLAGS.some(f => normalized.includes(f))) {
    return "commander";
  }

  // Layer 3: verb from subcommand (third token)
  const parts = normalized.split(/\s+/);
  const subcommand = parts[2] ?? "";
  const verb = subcommand.split("-")[0];

  if (!verb) {
    return "unknown";
  }

  if (READ_ONLY_VERBS.includes(verb)) return "read";
  if (DESTRUCTIVE_VERBS.includes(verb)) return "commander";

  return "operator";
}
