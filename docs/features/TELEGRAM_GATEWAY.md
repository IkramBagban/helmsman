# Feature: Telegram Gateway

> **Package:** `apps/api` (Telegram-specific routes + handlers)
> **Wave:** 1 (no internal dependencies)
> **Dependencies:** `@helmsman/shared` (types), grammY (Telegram SDK)
> **Estimated effort:** 3-4 days

---

## Purpose

Accept incoming Telegram messages via webhook, normalize them into a platform-agnostic format, deduplicate retries, and deliver agent responses back to the user. This is the only chat transport layer for MVP.

---

## Requirements

### Must Have
- [ ] Receive Telegram webhook updates (messages, commands)
- [ ] Validate webhook authenticity (verify `X-Telegram-Bot-Api-Secret-Token`)
- [ ] Parse text messages into `NormalizedMessage` format
- [ ] Deduplicate webhook retries (Telegram retries on slow responses)
- [ ] Send typing indicator immediately on message receipt
- [ ] Deliver agent text responses back to the Telegram chat
- [ ] Handle errors gracefully (user sees friendly message, not a crash)
- [ ] Respond to `/start` command with welcome message
- [ ] Health check endpoint (`GET /health`)

### Nice to Have
- [ ] Handle photo/document uploads (extract text, store reference)
- [ ] Support reply-to threading (user replies to agent message)
- [ ] Support `/help` command listing capabilities
- [ ] Rate limiting per user (prevent abuse)

### Out of Scope
- Slack integration (Phase 2)
- Voice messages
- Inline keyboards for approval (use text-based approval for MVP)

---

## Contracts

### Input: Telegram Webhook Update (from Telegram → our server)

```typescript
// Zod schema for Telegram Update (subset we care about)
import { z } from "zod";

export const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z.object({
    message_id: z.number(),
    from: z.object({
      id: z.number(),
      first_name: z.string(),
      last_name: z.string().optional(),
      username: z.string().optional(),
    }),
    chat: z.object({
      id: z.number(),
      type: z.enum(["private", "group", "supergroup"]),
    }),
    date: z.number(), // Unix timestamp
    text: z.string().optional(),
    reply_to_message: z.object({
      message_id: z.number(),
    }).optional(),
  }).optional(),
});
```

### Output: NormalizedMessage (from gateway → agent-core)

```typescript
// Defined in @helmsman/shared
export interface NormalizedMessage {
  platform: "telegram" | "slack";
  chatId: string;
  messageId: string;
  userId: string;
  text: string;
  timestamp: Date;
  correlationId: string; // generated UUID for this request
  replyToMessageId?: string;
  metadata?: Record<string, unknown>;
}
```

### Input from Agent: AgentResponse (from agent-core → gateway)

```typescript
export interface AgentResponse {
  text: string;
  status: "success" | "error" | "pending_approval";
  correlationId: string;
  plan?: PlanSummary;
  metadata?: Record<string, unknown>;
}
```

---

## Architecture

```
Telegram Cloud
  │  setWebhook(url, secret_token)
  │
  ▼  POST /webhook/telegram (HTTPS)
┌──────────────────────────────────────┐
│           apps/api                    │
│                                       │
│  1. Validate webhook secret header     │
│  2. Parse TelegramUpdate              │
│  3. Dedup (check update_id / msg_id)  │
│  4. Send typing indicator             │
│  5. Normalize → NormalizedMessage     │
│  6. Call agent-core.handleMessage()   │
│  7. Format AgentResponse → Telegram   │
│  8. Send reply via Bot API sendMessage │
│  9. Return 200 OK                     │
└──────────────────────────────────────┘
```

---

## File Structure

```
apps/api/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts                        # Express app entry, start server
    routes/
      telegram.ts                   # POST /webhook/telegram
      health.ts                     # GET /health
    telegram/
      parser.ts                     # Parse TelegramUpdate → NormalizedMessage
      parser.test.ts
      dedup.ts                      # Deduplication by update_id
      dedup.test.ts
      sender.ts                     # Send messages back to Telegram
      sender.test.ts
      commands.ts                   # /start, /help command handlers
      commands.test.ts
      types.ts                      # Telegram-specific types
    middleware/
      error-handler.ts              # Global error handler
      correlation-id.ts             # Attach correlationId to request context
    config.ts                       # Env validation for API app
```

---

## Implementation Notes

### Webhook Setup
```typescript
// Use grammY's webhook handler with Express
import { Bot, webhookCallback } from "grammy";

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// grammY handles all the Telegram-specific parsing
app.post(
  "/webhook/telegram",
  webhookCallback(bot, "express", {
    secretToken: env.TELEGRAM_WEBHOOK_SECRET,
  }),
);
```

At deploy time, configure Telegram to call your public HTTPS endpoint:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://<your-domain>/webhook/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Notes:
- Telegram calls your API only after `setWebhook` is configured.
- Endpoint must be publicly reachable over HTTPS.
- API should return `200` quickly to avoid retries.

### Deduplication
- Store last 1000 `update_id` values in memory (Map with TTL)
- If `update_id` already seen, return 200 immediately without processing
- Telegram retries if it doesn't get 200 within ~60 seconds

```typescript
const seenUpdates = new Map<number, number>(); // update_id → timestamp
const DEDUP_TTL = 5 * 60 * 1000; // 5 minutes

function isDuplicate(updateId: number): boolean {
  if (seenUpdates.has(updateId)) return true;
  seenUpdates.set(updateId, Date.now());
  // Cleanup old entries periodically
  return false;
}
```

### Typing Indicator
- Send `sendChatAction("typing")` immediately when a message is received
- Repeat every 4 seconds while agent is processing (Telegram typing indicator lasts 5s)

### Sending Message to User
- Use grammY `bot.api.sendMessage(chatId, text, options)` for normal replies
- Use `bot.api.sendChatAction(chatId, "typing")` while processing
- Split responses over 4096 chars into chunks and send sequentially

### Error Handling
- If agent-core throws, catch and send a friendly error message:
  `"Sorry, something went wrong. Please try again."`
- Always return HTTP 200 to Telegram (even on errors) to prevent infinite retries
- Log the full error with correlationId for debugging

### Response Formatting
- Telegram supports Markdown (MarkdownV2) and HTML
- Use HTML for agent responses (more reliable escaping)
- Split long messages at 4096 chars (Telegram limit)
- Format plans as structured lists with clear steps

---

## Environment Variables (This Package)

```typescript
const ApiEnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16), // for webhook verification
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});
```

---

## Testing Plan

### Unit Tests
| Test | What |
|------|------|
| `parser.test.ts` | Parses valid Telegram updates into NormalizedMessage correctly |
| `parser.test.ts` | Handles missing optional fields (no username, no reply_to) |
| `parser.test.ts` | Rejects invalid/malformed updates |
| `dedup.test.ts` | Returns true for duplicate update_ids |
| `dedup.test.ts` | Returns false for new update_ids |
| `dedup.test.ts` | Cleans up expired entries |
| `commands.test.ts` | /start returns welcome message |
| `sender.test.ts` | Splits long messages at 4096 chars |
| `sender.test.ts` | Escapes HTML entities in agent responses |

### Integration Tests
| Test | What |
|------|------|
| `telegram.test.ts` | Full webhook → normalize → mock agent → reply flow |
| `telegram.test.ts` | Duplicate update returns 200 without processing |
| `telegram.test.ts` | Invalid payload returns 200 (don't retry) |
| `health.test.ts` | GET /health returns 200 |

---

## Acceptance Criteria

1. Send a text message to the Telegram bot → receive a response within 10 seconds
2. Same message sent twice (retry) → only processed once
3. Invalid webhook payload → returns 200, logs error, no crash
4. Bot shows "typing..." while processing
5. Long responses (>4096 chars) are split correctly
6. `/start` returns a welcome message explaining what Helmsman does
7. Server crash in agent-core → user gets friendly error, webhook returns 200
8. Health endpoint returns 200 with uptime info
