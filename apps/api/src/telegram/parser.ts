import { randomUUID } from "node:crypto";

import { AppError, isTelegramUpdate, type NormalizedMessage, type TelegramUpdate } from "@helmsman/shared";

import type { SupportedTelegramUpdate } from "./types.js";

const hasMessagePayload = (update: TelegramUpdate): update is SupportedTelegramUpdate => {
  return Boolean(update.message?.text && update.message.from.id && update.message.chat.id);
};

export const parseTelegramUpdate = (
  payload: unknown,
  correlationId?: string,
): NormalizedMessage | null => {
  if (!isTelegramUpdate(payload)) {
    throw new AppError("TELEGRAM_PAYLOAD_INVALID", "Invalid Telegram update payload");
  }

  const update = payload;
  if (!hasMessagePayload(update)) {
    return null;
  }

  const text = update.message.text;
  if (!text) {
    return null;
  }

  return {
    platform: "telegram",
    chatId: String(update.message.chat.id),
    messageId: String(update.message.message_id),
    userId: String(update.message.from.id),
    text,
    timestamp: new Date(update.message.date * 1000),
    correlationId: correlationId ?? randomUUID(),
    replyToMessageId: update.message.reply_to_message
      ? String(update.message.reply_to_message.message_id)
      : undefined,
    metadata: {
      telegramUpdateId: update.update_id,
      chatType: update.message.chat.type,
      username: update.message.from.username,
    },
  };
};
