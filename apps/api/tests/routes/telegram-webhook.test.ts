import { afterEach, describe, expect, it } from "bun:test";
import type { Server } from "node:http";

import { createApp } from "../../src/app.js";
import type { ApiEnv } from "../../src/config.js";
import type { TelegramAgentService, TelegramMessageSender } from "../../src/routes/telegram.js";
import { InMemoryDedupStore } from "../../src/telegram/dedup.js";

const baseEnv: ApiEnv = {
  port: 3000,
  nodeEnv: "test",
  telegramBotToken: "test-bot-token",
  telegramWebhookSecret: "test-webhook-secret-1234",
  llmProvider: "echo",
};

const servers: Server[] = [];

const startAppServer = async (app: ReturnType<typeof createApp>): Promise<string> => {
  const server = app.listen(0);
  servers.push(server);

  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve server address");
  }

  return `http://127.0.0.1:${address.port}`;
};

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) {
      continue;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
});

describe("POST /webhook/telegram", () => {
  it("should process updates with mocked sender and mocked agent service", async () => {
    const typingCalls: string[] = [];
    const sentMessages: { chatId: string; text: string }[] = [];

    const sender: TelegramMessageSender = {
      async sendTyping(chatId: string): Promise<void> {
        typingCalls.push(chatId);
      },
      async sendResponse(chatId: string, text: string): Promise<void> {
        sentMessages.push({ chatId, text });
      },
    };

    const agentService: TelegramAgentService = {
      async handleMessage(): Promise<{ correlationId: string; status: "success"; text: string }> {
        return {
          correlationId: "corr-test-1",
          status: "success",
          text: "mocked agent response",
        };
      },
    };

    const app = createApp(baseEnv, {
      telegram: {
        dedupStore: new InMemoryDedupStore(),
        sender,
        agentService,
      },
    });
    const baseUrl = await startAppServer(app);

    const response = await fetch(`${baseUrl}/webhook/telegram`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": baseEnv.telegramWebhookSecret,
      },
      body: JSON.stringify({
        update_id: 1001,
        message: {
          message_id: 11,
          from: { id: 99, first_name: "Test User" },
          chat: { id: 42, type: "private" },
          date: 1_700_000_000,
          text: "deploy status",
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("x-correlation-id")).toBeString();
    expect(typingCalls).toEqual(["42"]);
    expect(sentMessages).toEqual([{ chatId: "42", text: "mocked agent response" }]);
  });

  it("should still return 200 when mocked agent service throws", async () => {
    const sender: TelegramMessageSender = {
      async sendTyping(): Promise<void> {
        return;
      },
      async sendResponse(): Promise<void> {
        return;
      },
    };

    const agentService: TelegramAgentService = {
      async handleMessage(): Promise<{ correlationId: string; status: "success"; text: string }> {
        throw new Error("simulated agent failure");
      },
    };

    const app = createApp(baseEnv, {
      telegram: {
        dedupStore: new InMemoryDedupStore(),
        sender,
        agentService,
      },
    });
    const baseUrl = await startAppServer(app);

    const response = await fetch(`${baseUrl}/webhook/telegram`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": baseEnv.telegramWebhookSecret,
      },
      body: JSON.stringify({
        update_id: 1002,
        message: {
          message_id: 12,
          from: { id: 100, first_name: "Test User" },
          chat: { id: 43, type: "private" },
          date: 1_700_000_000,
          text: "deploy now",
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("should return 200 from error middleware when webhook handler throws", async () => {
    const app = createApp(baseEnv, {
      telegramWebhookHandler: {
        async handle(): Promise<Response> {
          throw new Error("simulated route failure");
        },
      },
    });
    const baseUrl = await startAppServer(app);

    const response = await fetch(`${baseUrl}/webhook/telegram`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": baseEnv.telegramWebhookSecret,
      },
      body: JSON.stringify({
        update_id: 1003,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("should return approval instructions when agent asks for approval", async () => {
    const sentMessages: { chatId: string; text: string }[] = [];

    const sender: TelegramMessageSender = {
      async sendTyping(): Promise<void> {
        return;
      },
      async sendResponse(chatId: string, text: string): Promise<void> {
        sentMessages.push({ chatId, text });
      },
    };

    const agentService: TelegramAgentService = {
      async handleMessage(): Promise<{
        correlationId: string;
        status: "pending_approval";
        text: string;
        metadata: Record<string, unknown>;
      }> {
        return {
          correlationId: "corr-approval",
          status: "pending_approval",
          text: "Approval required for this action.",
          metadata: {
            toolName: "aws:ec2:Execute",
            parameters: { action: "TerminateInstances", params: { instanceIds: ["i-123"] } },
          },
        };
      },
    };

    const app = createApp(baseEnv, {
      telegram: {
        dedupStore: new InMemoryDedupStore(),
        sender,
        agentService,
      },
    });
    const baseUrl = await startAppServer(app);

    const response = await fetch(`${baseUrl}/webhook/telegram`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": baseEnv.telegramWebhookSecret,
      },
      body: JSON.stringify({
        update_id: 1004,
        message: {
          message_id: 13,
          from: { id: 101, first_name: "Test User" },
          chat: { id: 44, type: "private" },
          date: 1_700_000_000,
          text: "terminate now",
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]?.text).toContain("/approve ");
  });

  it("should sanitize internal tool wording in pending approval response", async () => {
    const sentMessages: { chatId: string; text: string }[] = [];

    const sender: TelegramMessageSender = {
      async sendTyping(): Promise<void> {
        return;
      },
      async sendResponse(chatId: string, text: string): Promise<void> {
        sentMessages.push({ chatId, text });
      },
    };

    const agentService: TelegramAgentService = {
      async handleMessage(): Promise<{
        correlationId: string;
        status: "pending_approval";
        text: string;
        metadata: Record<string, unknown>;
      }> {
        return {
          correlationId: "corr-approval-2",
          status: "pending_approval",
          text: "Tool shell.execute has risk tier significant and requires explicit approval.",
          metadata: {
            toolName: "shell.execute",
            parameters: { command: "aws ec2 stop-instances --instance-ids i-123" },
          },
        };
      },
    };

    const app = createApp(baseEnv, {
      telegram: {
        dedupStore: new InMemoryDedupStore(),
        sender,
        agentService,
      },
    });
    const baseUrl = await startAppServer(app);

    const response = await fetch(`${baseUrl}/webhook/telegram`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": baseEnv.telegramWebhookSecret,
      },
      body: JSON.stringify({
        update_id: 1005,
        message: {
          message_id: 14,
          from: { id: 102, first_name: "Test User" },
          chat: { id: 45, type: "private" },
          date: 1_700_000_000,
          text: "stop staging",
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]?.text).not.toContain("Tool shell.execute");
    expect(sentMessages[0]?.text).toContain("needs your approval");
  });
});
