const REDACTION_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----[\s\S]*?-----END \S+ PRIVATE KEY-----/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /github_pat_[A-Za-z0-9_]{82}/g,
  /gho_[A-Za-z0-9]{36}/g,
  /ghs_[A-Za-z0-9]{36}/g,
  /AKIA[0-9A-Z]{16}/g,
  /(?:aws_secret_access_key|x-amz-security-token|authorization)\s*[:=]\s*[^\s"']+/gi,
  /(token|password|secret|private[_-]?key)\s*[:=]\s*[^\s"']+/gi,
];

export const redactOutput = (raw: string): string => {
  let value = raw;
  for (const pattern of REDACTION_PATTERNS) {
    value = value.replaceAll(pattern, (_m, key: string | undefined) => (key ? `${key}=[REDACTED]` : "[REDACTED]"));
  }
  return value;
};
