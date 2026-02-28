import type { AgentResponse } from "@helmsman/shared";

import type { SupportedTelegramUpdate } from "./types.js";

export const getCommandResponse = (
  update: SupportedTelegramUpdate,
  correlationId: string,
): AgentResponse | null => {
  const incomingText = update.message.text;
  if (!incomingText) {
    return null;
  }

  const text = incomingText.trim();
  if (text === "/start") {
    return {
      correlationId,
      status: "success",
      text: "Hi! I am Helmsman. Ask me DevOps questions and I will help you reason through your infrastructure.",
    };
  }

  if (text === "/help") {
    return {
      correlationId,
      status: "success",
      text: "Commands:\n/start - introduction\n/help - list commands\n\nThen send any question to chat with the assistant.",
    };
  }

  return null;
};
