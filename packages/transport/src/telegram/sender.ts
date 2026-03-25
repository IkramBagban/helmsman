import { Api } from "grammy";

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
  private readonly api: Api;

  public constructor(botToken: string) {
    this.api = new Api(botToken);
  }

  public async sendTyping(chatId: string): Promise<void> {
    await this.api.sendChatAction(Number(chatId), "typing");
  }

  public async sendResponse(chatId: string, text: string): Promise<void> {
    const escaped = escapeHtml(text);
    const chunks = splitMessage(escaped);

    for (const chunk of chunks) {
      await this.api.sendMessage(Number(chatId), chunk, {
        parse_mode: "HTML",
      });
    }
  }
}

export const __internal = {
  escapeHtml,
  splitMessage,
};
