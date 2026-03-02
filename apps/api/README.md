# Helmsman API

HTTP API for Telegram webhook intake and response delivery.

## Environment

- `PORT` (default `3000`)
- `NODE_ENV` (`development` | `production` | `test`)
- `TELEGRAM_BOT_TOKEN` Telegram bot token from BotFather
- `TELEGRAM_WEBHOOK_SECRET` secret token configured in Telegram webhook
- `LLM_PROVIDER` (`gemini` | `openai` | `echo`) - default: `gemini`
- Gemini key (required when `LLM_PROVIDER=gemini`): any one of
  - `GEMINI_API_KEY`
  - `GOOGLE_API_KEY`
  - `GOOGLE_GENERATIVE_AI_API_KEY`
- `GEMINI_BASE_URL` optional override
- `OPENAI_API_KEY` required when `LLM_PROVIDER=openai`
- `OPENAI_BASE_URL` optional override
- `GITHUB_TOKEN` optional, enables authenticated GitHub tool access and higher rate limits
- `GITHUB_API_BASE_URL` optional override for GitHub Enterprise API
- AWS Knowledge MCP options (optional, improves AWS reasoning and lowers hallucinations):
  - `AWS_KNOWLEDGE_MCP_URL`
  - `AWS_KNOWLEDGE_MCP_API_KEY`
  - `AWS_KNOWLEDGE_MCP_TIMEOUT_MS` (default `12000`)
- DevOps runtime options (optional, used by Docker-backed execution tools):
  - `HELMSMAN_RUNTIME_IMAGE`
  - `DOCKER_SOCKET_PATH`
  - `CONTAINER_DEFAULT_TIMEOUT_MS`
  - `CONTAINER_DEFAULT_MEMORY_BYTES`
  - `CONTAINER_DEFAULT_CPU_QUOTA`
  - `HELMSMAN_ENFORCE_EGRESS_ALLOWLIST`

Copy environment defaults:

```bash
cp apps/api/.env.example apps/api/.env
```

## Run

```bash
bun run dev
```

From repo root:

```bash
bun run dev --filter api
```

## Local Telegram Setup (Step-by-step)

1. Create env file from example.

```bash
cp .env.example .env
```

2. Fill required values in `.env`:
   - `TELEGRAM_BOT_TOKEN` (from BotFather)
   - `TELEGRAM_WEBHOOK_SECRET` (random string, 16+ chars)
   - `LLM_PROVIDER=gemini`
   - One Gemini key: `GEMINI_API_KEY` or `GOOGLE_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`

3. Start API locally.

```bash
bun run dev
```

4. Expose local API via HTTPS tunnel.

```bash
ngrok http 3000
```

5. Register Telegram webhook (replace URL with your tunnel URL).

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://<ngrok-id>.ngrok-free.app/webhook/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

6. Verify webhook configuration.

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

Expected:
- `"ok": true`
- `result.url` matches your ngrok webhook URL
- no recent delivery errors

7. Test in Telegram.
- Send `/start`
- Send `/help`
- Send a normal message and confirm LLM response arrives

## Tooling Notes

- Telegram requests now include `ShellExecuteTool`, GitHub tools, and Docker-backed DevOps runtime tools in the same agent tool registry.
- GitHub tools are most reliable with `GITHUB_TOKEN` configured.
- DevOps runtime tools require Docker access from the API process (`DOCKER_SOCKET_PATH`) and a valid runtime image (`HELMSMAN_RUNTIME_IMAGE`).
- If runtime env vars are not configured, only shell and non-runtime tools should be used.

### Windows Docker Desktop note

- Keep Docker Desktop running whenever you want to use DevOps runtime tools.
- On Windows, set `DOCKER_SOCKET_PATH=//./pipe/docker_engine`.

## Troubleshooting

- `Bad Request: invalid webhook URL specified`
  - Ensure URL starts with exactly one `https://`
  - Ensure URL is public and reachable (not localhost)

- Bot not responding
  - Confirm app is running on port 3000
  - Confirm ngrok tunnel is active
  - Confirm `TELEGRAM_WEBHOOK_SECRET` exactly matches `secret_token` in `setWebhook`
  - Check `getWebhookInfo` for `last_error_message`

- Wrong LLM/provider errors
  - If `LLM_PROVIDER=gemini`, set one of: `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY`
  - If `LLM_PROVIDER=openai`, set `OPENAI_API_KEY`
