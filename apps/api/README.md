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

Copy environment defaults:

```bash
cp apps/api/.env.example apps/api/.env
```

## Run

```bash
bun run dev --filter api
```

## Webhook setup

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://<your-domain>/webhook/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

## Local Telegram test

1. Start the API and expose it publicly (for example with ngrok).
```bash
bun run dev --filter api
ngrok http 3000
```
2. Register webhook with the public URL.
```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://<ngrok-id>.ngrok-free.app/webhook/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```
3. Send a Telegram message to your bot and verify API logs include `correlationId`, route, status, and duration.
