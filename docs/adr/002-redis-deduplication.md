# ADR 002: Choosing Redis for Webhook Deduplication

## Status
Proposed (March 1, 2026)

## Context
Telegram webhooks are not idempotent. If Helmsman takes more than 30-60 seconds to process a message (common with LLM reasoning), Telegram will retry the same `update_id`. This can lead to duplicate agent actions (e.g., creating two servers). We need a persistent store to track processed `update_id`s across server restarts.

Options:
1. **Postgres (Database):** Already planned for long-term storage, but lacks built-in high-performance TTL-based cleaning for ephemeral data like "seen updates".
2. **Redis:** Ideal for session data and short-term locks. Standard for deduplication.

## Decision
We will use **Redis** via the specified `REDIS_URL`.

## Rational
- **Atomic Operations:** Redis `SET NX` (Set if Not Exists) provides a race-condition-free way to check if an update is being processed.
- **Auto-Expiration:** We only need to "remember" a message for ~5-10 minutes (Telegram retry window). Redis handles this natively with TTLs, keeping memory usage constant without manual cleanup scripts.
- **Speed:** Faster writes than Postgres, which is important for the hot path of webhook ingestion.

## Implementation Details
- Client: `ioredis` (Bun-compatible and mature).
- Pattern: `SETNX telegram:update:<id> true EX <ttl>`.
- Failover: If Redis is unavailable, the system should log an error but default to `InMemory` or allow the message (depending on risk profile). For MVP, we will require Redis if `REDIS_URL` is provided.
