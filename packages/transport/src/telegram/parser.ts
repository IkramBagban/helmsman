import { randomUUID } from "node:crypto";

import { AppError, isTelegramUpdate, type NormalizedMessage, type TelegramUpdate } from "@helmsman/shared";

import type { SupportedTelegramUpdate } from "./types.js";

const hasMessagePayload = (update: TelegramUpdate): update is SupportedTelegramUpdate => {
  return Boolean(update.message?.text && update.message.from.id && update.message.chat.id);
};

const normalizeTranscriptLikeText = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }

  const transcriptMarkers = /(ikram:|jack:)/i;
  if (!transcriptMarkers.test(trimmed)) {
    return trimmed;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let lastUserLine = "";

  for (const line of lines) {
    const userMatch = line.match(/^ikram:\s*(.*)$/i);
    if (userMatch) {
      const content = userMatch[1]?.trim();
      if (content) {
        lastUserLine = content;
      }
      continue;
    }

    if (/^jack:/i.test(line)) {
      continue;
    }

    if (lastUserLine && !/^\//.test(line)) {
      // Continuation of the last Ikram block.
      lastUserLine = `${lastUserLine} ${line}`.trim();
    }
  }

  return lastUserLine || trimmed;
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

  const rawText = update.message.text;
  if (typeof rawText !== "string") {
    return null;
  }

  const text = normalizeTranscriptLikeText(rawText);
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
