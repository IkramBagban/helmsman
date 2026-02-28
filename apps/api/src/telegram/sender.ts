const TELEGRAM_MESSAGE_LIMIT = 4096;

const escapeHtml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
};

const splitMessage = (message: string, chunkSize: number = TELEGRAM_MESSAGE_LIMIT): string[] => {
  const chunks: string[] = [];
  for (let index = 0; index < message.length; index += chunkSize) {
    chunks.push(message.slice(index, index + chunkSize));
  }

  return chunks.length > 0 ? chunks : [""];
};

export class TelegramSender {
  private readonly botToken: string;

  public constructor(botToken: string) {
    this.botToken = botToken;
  }

  public async sendTyping(chatId: string): Promise<void> {
    await this.callTelegram("sendChatAction", {
      chat_id: Number(chatId),
      action: "typing",
    });
  }

  public async sendResponse(chatId: string, text: string): Promise<void> {
    const escaped = escapeHtml(text);
    const chunks = splitMessage(escaped);

    for (const chunk of chunks) {
      await this.callTelegram("sendMessage", {
        chat_id: Number(chatId),
        text: chunk,
        parse_mode: "HTML",
      });
    }
  }

  private async callTelegram(method: string, payload: Record<string, unknown>): Promise<void> {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API ${method} failed: ${response.status} ${body}`);
    }
  }
}

export const __internal = {
  escapeHtml,
  splitMessage,
};
