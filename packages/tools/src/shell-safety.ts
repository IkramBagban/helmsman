/**
 * Shell command safety layer — allowlists, blocked patterns, and risk classification.
 *
 * This module is the guardrail between the LLM and actual command execution.
 * Every command passes through parseCommand → validateCommand → classifyCommandRisk
 * before it is executed.
 */

import type { RiskTier } from "@helmsman/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedCommand {
  /** The binary name (e.g. "aws", "kubectl") */
  readonly binary: string;
  /** The full raw command string */
  readonly raw: string;
  /** The arguments after the binary */
  readonly args: readonly string[];
}

export interface CommandValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Allowlisted binaries — nothing else can run
// ---------------------------------------------------------------------------

export const ALLOWED_BINARIES: readonly string[] = [
  "aws",      // AWS CLI — covers all 300+ services
  "kubectl",  // Kubernetes cluster management
  "helm",     // Kubernetes package management
  "docker",   // Container inspect-only operations
  "curl",     // HTTP calls (restricted use)
  "jq",       // JSON processing
] as const;

// ---------------------------------------------------------------------------
// Blocked patterns — even if the binary is allowed, these are rejected
// ---------------------------------------------------------------------------

interface BlockedPattern {
  readonly pattern: RegExp;
  readonly reason: string;
}

export const BLOCKED_PATTERNS: readonly BlockedPattern[] = [
  { pattern: /rm\s+-rf/i, reason: "Recursive delete is blocked" },
  { pattern: />\s*\/dev/, reason: "Writing to device files is blocked" },
  { pattern: /\|\s*sh\b/, reason: "Piping to shell is blocked" },
  { pattern: /\|\s*bash\b/, reason: "Piping to bash is blocked" },
  { pattern: /\|\s*zsh\b/, reason: "Piping to zsh is blocked" },
  { pattern: /\|\s*powershell\b/i, reason: "Piping to powershell is blocked" },
  { pattern: /\$\(/, reason: "Command substitution $() is blocked" },
  { pattern: /;\s*(rm|mv|cp|chmod|chown|dd)\b/, reason: "Chained destructive operations are blocked" },
  { pattern: /--force-delete/i, reason: "Force-delete flags are blocked" },
  { pattern: />\s*\/etc/, reason: "Writing to /etc is blocked" },
  { pattern: /eval\s/, reason: "eval is blocked" },
  { pattern: /source\s/, reason: "source is blocked" },
  { pattern: /\.\s+\//, reason: "Sourcing scripts is blocked" },
  { pattern: /&&/, reason: "Chaining commands with && is blocked" },
  { pattern: /\|\|/, reason: "Chaining commands with || is blocked" },
  { pattern: /;\s*[a-z]/, reason: "Semicolon command chaining is blocked" },
] as const;

// ---------------------------------------------------------------------------
// Risk classification — pattern-match on the command to determine risk tier
// ---------------------------------------------------------------------------

/** Patterns that indicate destructive intent */
const DESTRUCTIVE_PATTERNS = [
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bdestroy\b/i,
  /\bterminate\b/i,
  /\bpurge\b/i,
  /\bderegister\b/i,
  /\brelease-\b/i,      // release-address, release-hosts (AWS actions, not names like 'my-release')
  /\bforce-delete\b/i,
];

/** Patterns that indicate write/mutate operations */
const SIGNIFICANT_PATTERNS = [
  /\bcreate\b/i,
  /\bupdate\b/i,
  /\bmodify\b/i,
  /\bput-\b/i,
  /\bapply\b/i,
  /\bdeploy\b/i,
  /\bstop\b/i,
  /\bstart\b/i,
  /\breboot\b/i,
  /\brestart\b/i,
  /\bscale\b/i,
  /\breplicate\b/i,
  /\battach\b/i,
  /\bdetach\b/i,
  /\bauthorize\b/i,
  /\brevoke\b/i,
  /\bassociate\b/i,
  /\bdisassociate\b/i,
  /\benable\b/i,
  /\bdisable\b/i,
  /\brun-\b/i,        // run-instances, run-task
  /\bexecute\b/i,
  /\binvoke\b/i,
  /\bset\b/i,
  /\btag\b/i,
  /\buntag\b/i,
];

/** Patterns that indicate read-only operations */
const READ_ONLY_PATTERNS = [
  /\bdescribe\b/i,
  /\blist\b/i,
  /\bget[-\s]|\bget$/i,
  /\bshow\b/i,
  /\blogs?\b/i,
  /\bstatus\b/i,
  /\bwait\b/i,
  /\bhead-\b/i,
  /\blookup\b/i,
  /\bsearch\b/i,
  /\bhelp\b/i,
  /\b--dry-run\b/i,
  /\bwhoami\b/i,
  /\bversion\b/i,
  /\bconfigure\s+list\b/i,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw command string into structured parts.
 */
export function parseCommand(raw: string): ParsedCommand {
  const trimmed = raw.trim();
  const parts = tokenizeCommand(trimmed);
  const binary = parts[0] ?? "";
  const args = parts.slice(1);

  return { binary, raw: trimmed, args };
}

function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\" && !inSingleQuote) {
      escaping = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function hasUnquotedBacktick(input: string): boolean {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === "\\" && !inSingleQuote) {
      escaping = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === "`" && !inSingleQuote && !inDoubleQuote) {
      return true;
    }
  }

  return false;
}

/**
 * Validate a parsed command against the allowlist and blocked patterns.
 * Returns { valid: true } if the command is safe to execute, or
 * { valid: false, reason: "..." } if it should be rejected.
 */
export function validateCommand(cmd: ParsedCommand): CommandValidationResult {
  // 1. Empty command
  if (!cmd.binary) {
    return { valid: false, reason: "Empty command" };
  }

  // 2. Binary allowlist
  if (!ALLOWED_BINARIES.includes(cmd.binary)) {
    return {
      valid: false,
      reason: `Binary '${cmd.binary}' is not allowed. Allowed: ${ALLOWED_BINARIES.join(", ")}`,
    };
  }

  // 3.1 Block command substitution with unquoted backticks
  if (hasUnquotedBacktick(cmd.raw)) {
    return { valid: false, reason: "Backtick execution is blocked" };
  }

  // 3.2 Blocked patterns
  for (const blocked of BLOCKED_PATTERNS) {
    if (blocked.pattern.test(cmd.raw)) {
      return { valid: false, reason: blocked.reason };
    }
  }

  // 4. Maximum command length (prevent prompt injection via absurdly long commands)
  if (cmd.raw.length > 2000) {
    return { valid: false, reason: "Command exceeds maximum length (2000 chars)" };
  }

  return { valid: true };
}

/**
 * Classify the risk tier of a command based on its content.
 * Used by the policy engine to decide if approval is required.
 */
export function classifyCommandRisk(cmd: ParsedCommand): RiskTier {
  const raw = cmd.raw;

  // Anything with --dry-run is read_only regardless
  if (/--dry-run/i.test(raw)) {
    return "read_only";
  }

  // Check destructive first (highest risk)
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(raw)) {
      return "destructive";
    }
  }

  // Check read-only before significant to avoid false positives from parameter names
  // like Start=..., while command operation itself is get/list/describe.
  for (const pattern of READ_ONLY_PATTERNS) {
    if (pattern.test(raw)) {
      return "read_only";
    }
  }

  // Check significant (write/mutate)
  for (const pattern of SIGNIFICANT_PATTERNS) {
    if (pattern.test(raw)) {
      return "significant";
    }
  }

  // Default: significant (conservative — unknown commands require approval)
  return "significant";
}
