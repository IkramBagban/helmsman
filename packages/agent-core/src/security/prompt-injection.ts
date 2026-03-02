const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore\s+(all\s+)?(previous|prior|earlier)\s+instructions?\b/i,
  /\bforget\s+(all\s+)?(system|safety|security|policy)\s+(prompt|instructions?)\b/i,
  /\b(override|bypass|disable)\s+(the\s+)?(policy|guardrails?|safety|security)\b/i,
  /\b(system\s+prompt|developer\s+message)\b.*\b(show|reveal|print|leak)\b/i,
  /\b(do not|don't)\s+ask\s+for\s+approval\b/i,
  /\brun\s+(it\s+)?now\s+without\s+approval\b/i,
  /\byou\s+are\s+now\s+(root|admin|superuser)\b/i,
  /\bexecute\s+destructive\s+commands?\s+immediately\b/i,
];

export interface PromptInjectionCheckResult {
  readonly blocked: boolean;
  readonly reason?: string;
}

export const detectPromptInjectionAttempt = (message: string): PromptInjectionCheckResult => {
  const normalized = message.trim();
  if (!normalized) {
    return { blocked: false };
  }

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        blocked: true,
        reason: `Matched suspicious pattern: ${pattern.source}`,
      };
    }
  }

  return { blocked: false };
};

export const PROMPT_INJECTION_REFUSAL =
  "I can't comply with requests to bypass safety, policy, or approval controls. " +
  "If you want to proceed with an infrastructure change, describe the intended action and I will follow the secure approval flow.";

