/** Max characters in a final response - Telegram-safe with buffer under 4096. */
export const MAX_RESPONSE_LENGTH = 3900;
/** Max tool iterations for the DevOps agent. */
export const MAX_STEPS = 8;
/** Max short-term conversation turns retained in-memory per chat. */
export const MAX_HISTORY_TURNS = 8;
/** Max age for in-memory activation continuations. */
export const PENDING_CONTEXT_TTL_MS = 15 * 60 * 1000;
