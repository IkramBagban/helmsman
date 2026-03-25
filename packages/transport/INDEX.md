# transport

Telegram message handling: parsing, sending, command detection, and deduplication.

## Responsibility
Provides utilities for the API layer to parse incoming Telegram updates, format and send responses, detect slash commands, and deduplicate messages using Redis.

## Key Files
```
src/
  telegram/
    parser.ts       ← Parses raw Telegram update payloads into internal message types
    sender.ts       ← Formats and sends messages back to Telegram via grammY API client
    commands.ts     ← Slash command detection and routing
    dedup.ts        ← Redis-backed message deduplication
    types.ts        ← Transport-level types
  index.ts          ← Re-exports all modules
```

## Exports
- `parseTelegramUpdate(update)` — parses a raw Telegram update
- `sendTelegramMessage(chatId, text)` — sends a formatted message
- `isCommand(text)` — detects slash commands
- `MessageDeduplicator` — Redis-backed dedup class

## Dependencies
`@helmsman/shared`, `grammy`, `ioredis`
