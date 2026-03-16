export interface ScheduleMessageSender {
  sendTyping(chatId: string, platform?: string): Promise<void>;
  sendResponse(chatId: string, text: string, platform?: string): Promise<void>;
}
