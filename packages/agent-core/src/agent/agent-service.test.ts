import { describe, expect, it } from "bun:test";
import { ToolRegistry, ShellExecuteTool } from "@helmsman/tools";
import type { RiskTier, ToolExecutionResult } from "@helmsman/shared";

import { HelmsmanAgentService } from "./agent-service";

describe("HelmsmanAgentService", () => {
  it("should return llm output with correlation id", async () => {
    const service = new HelmsmanAgentService({
      llmProvider: {
        generate: async () => ({
          model: "test-model",
          text: "hello from llm",
        }),
      },
    });

    const response = await service.handleMessage({
      platform: "telegram",
      chatId: "1",
      messageId: "2",
      userId: "3",
      text: "hey",
      timestamp: new Date(),
      correlationId: "corr-1",
    });

    expect(response.correlationId).toBe("corr-1");
    expect(response.text).toBe("hello from llm");
    expect(response.status).toBe("success");
  });

  it("should return pending_approval for significant tool calls", async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "aws:ec2:Execute",
        description: "EC2 command executor",
        parameters: { action: "string", params: "object" },
        riskTier: "significant" satisfies RiskTier,
      },
      execute: async (): Promise<ToolExecutionResult> => ({
        success: true,
        output: "ok",
      }),
    });

    const service = new HelmsmanAgentService({
      llmProvider: {
        generate: async () => ({
          model: "test-model",
          text: JSON.stringify({
            type: "tool_call",
            toolName: "aws:ec2:Execute",
            parameters: { action: "TerminateInstances", params: { instanceIds: ["i-123"] } },
          }),
        }),
      },
      policyEngine: {
        evaluate: async () => ({
          action: "require_approval",
          reason: "Approval required for significant action",
        }),
      },
      auditService: {
        log: async () => undefined,
      },
      toolRegistry: registry,
    });

    const response = await service.handleMessage({
      platform: "telegram",
      chatId: "1",
      messageId: "2",
      userId: "3",
      text: "terminate the instance",
      timestamp: new Date(),
      correlationId: "corr-2",
    });

    expect(response.status).toBe("pending_approval");
    expect(response.text).toContain("Approval required");
  });

  it("should dynamically classify shell.execute risk based on command", async () => {
    const registry = new ToolRegistry();
    const shellTool = new ShellExecuteTool();
    registry.register(shellTool);

    // Track what risk tier was evaluated
    let evaluatedRiskTier: RiskTier | undefined;

    const service = new HelmsmanAgentService({
      llmProvider: {
        generate: async () => ({
          model: "test-model",
          text: JSON.stringify({
            type: "tool_call",
            toolName: "shell.execute",
            parameters: { command: "aws s3api list-buckets --output json" },
          }),
        }),
      },
      policyEngine: {
        evaluate: async (_req, riskTier) => {
          evaluatedRiskTier = riskTier;
          return { action: "allow" };
        },
      },
      auditService: {
        log: async () => undefined,
      },
      toolRegistry: registry,
    });

    // The command "list-buckets" is read_only, so dynamic risk should be read_only
    await service.handleMessage({
      platform: "telegram",
      chatId: "1",
      messageId: "2",
      userId: "3",
      text: "list my s3 buckets",
      timestamp: new Date(),
      correlationId: "corr-3",
    });

    expect(evaluatedRiskTier).toBe("read_only");
  });

  it("should classify destructive shell commands as destructive risk", async () => {
    const registry = new ToolRegistry();
    const shellTool = new ShellExecuteTool();
    registry.register(shellTool);

    let evaluatedRiskTier: RiskTier | undefined;

    const service = new HelmsmanAgentService({
      llmProvider: {
        generate: async () => ({
          model: "test-model",
          text: JSON.stringify({
            type: "tool_call",
            toolName: "shell.execute",
            parameters: { command: "aws ec2 terminate-instances --instance-ids i-123" },
          }),
        }),
      },
      policyEngine: {
        evaluate: async (_req, riskTier) => {
          evaluatedRiskTier = riskTier;
          return { action: "require_approval", reason: "Destructive action requires approval" };
        },
      },
      auditService: {
        log: async () => undefined,
      },
      toolRegistry: registry,
    });

    const response = await service.handleMessage({
      platform: "telegram",
      chatId: "1",
      messageId: "2",
      userId: "3",
      text: "terminate instance i-123",
      timestamp: new Date(),
      correlationId: "corr-4",
    });

    expect(evaluatedRiskTier).toBe("destructive");
    expect(response.status).toBe("pending_approval");
  });

  it("should never return raw tool-call json when parsing fails", async () => {
    const service = new HelmsmanAgentService({
      llmProvider: {
        generate: async () => ({
          model: "test-model",
          text: "I will fetch that now. ```tool_code\n{\"type\":\"tool_call\",\"toolName\":\"shell.execute\",\"parameters\":{\"command\":\"aws s3api list-buckets --output json\"}\n",
        }),
      },
    });

    const response = await service.handleMessage({
      platform: "telegram",
      chatId: "1",
      messageId: "2",
      userId: "3",
      text: "list buckets",
      timestamp: new Date(),
      correlationId: "corr-5",
    });

    expect(response.status).toBe("success");
    expect(response.text).not.toContain("tool_call");
    expect(response.text).not.toContain("shell.execute");
  });

  it("should sanitize final summarized output if model returns tool payload", async () => {
    let generateCount = 0;
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "shell.execute",
        description: "shell executor",
        parameters: { command: "string" },
        riskTier: "read_only",
      },
      execute: async (): Promise<ToolExecutionResult> => ({
        success: true,
        output: "[]",
      }),
    });

    const service = new HelmsmanAgentService({
      llmProvider: {
        generate: async () => {
          generateCount += 1;
          if (generateCount === 1) {
            return {
              model: "test-model",
              text: JSON.stringify({
                type: "tool_call",
                toolName: "shell.execute",
                parameters: { command: "aws s3api list-buckets --output json" },
              }),
            };
          }

          return {
            model: "test-model",
            text: '{"type":"tool_call","toolName":"shell.execute","parameters":{"command":"aws s3api list-buckets --output json"}}',
          };
        },
      },
      toolRegistry: registry,
    });

    const response = await service.handleMessage({
      platform: "telegram",
      chatId: "1",
      messageId: "2",
      userId: "3",
      text: "list buckets",
      timestamp: new Date(),
      correlationId: "corr-6",
    });

    expect(response.status).toBe("success");
    expect(response.text).not.toContain("tool_call");
    expect(response.text).not.toContain("shell.execute");
  });

  it("should not execute shell tool for ambiguous yes confirmation", async () => {
    const registry = new ToolRegistry();
    let executeCalled = false;

    registry.register({
      definition: {
        name: "shell.execute",
        description: "shell executor",
        parameters: { command: "string" },
        riskTier: "read_only",
      },
      execute: async (): Promise<ToolExecutionResult> => {
        executeCalled = true;
        return { success: true, output: "ok" };
      },
    });

    const service = new HelmsmanAgentService({
      llmProvider: {
        generate: async () => ({
          model: "test-model",
          text: JSON.stringify({
            type: "tool_call",
            toolName: "shell.execute",
            parameters: { command: "aws ec2 stop-instances --instance-ids i-123" },
          }),
        }),
      },
      toolRegistry: registry,
    });

    const response = await service.handleMessage({
      platform: "telegram",
      chatId: "1",
      messageId: "2",
      userId: "3",
      text: "Yes",
      timestamp: new Date(),
      correlationId: "corr-7",
    });

    expect(response.status).toBe("success");
    expect(executeCalled).toBe(false);
    expect(response.text.toLowerCase()).toContain("specific instruction");
  });

  it("should allow yes confirmation when previous assistant asked to proceed", async () => {
    const registry = new ToolRegistry();
    let executeCalled = false;

    registry.register({
      definition: {
        name: "shell.execute",
        description: "shell executor",
        parameters: { command: "string" },
        riskTier: "read_only",
      },
      execute: async (): Promise<ToolExecutionResult> => {
        executeCalled = true;
        return { success: true, output: JSON.stringify([]) };
      },
    });

    let generateCount = 0;
    const service = new HelmsmanAgentService({
      llmProvider: {
        generate: async () => {
          generateCount += 1;
          if (generateCount === 1) {
            return {
              model: "test-model",
              text: "Do you want me to proceed?",
            };
          }

          return {
            model: "test-model",
            text: JSON.stringify({
              type: "tool_call",
              toolName: "shell.execute",
              parameters: { command: "aws lambda list-functions --output json" },
            }),
          };
        },
      },
      toolRegistry: registry,
      policyEngine: {
        evaluate: async () => ({ action: "allow" }),
      },
    });

    await service.handleMessage({
      platform: "telegram",
      chatId: "chat-yes-1",
      messageId: "message-1",
      userId: "user-yes-1",
      text: "Check my lambda functions",
      timestamp: new Date(),
      correlationId: "corr-yes-allow-1",
    });

    const response = await service.handleMessage({
      platform: "telegram",
      chatId: "chat-yes-1",
      messageId: "message-2",
      userId: "user-yes-1",
      text: "Yes",
      timestamp: new Date(),
      correlationId: "corr-yes-allow-2",
    });

    expect(executeCalled).toBe(true);
    expect(response.status).toBe("success");
  });

  it("should use concise fallback summary when formatter LLM fails", async () => {
    let generateCount = 0;
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "shell.execute",
        description: "shell executor",
        parameters: { command: "string" },
        riskTier: "read_only",
      },
      execute: async (): Promise<ToolExecutionResult> => ({
        success: true,
        output: JSON.stringify({
          Buckets: [
            { Name: "bucket-a", CreationDate: "2026-01-01T00:00:00+00:00" },
            { Name: "bucket-b", CreationDate: "2026-01-02T00:00:00+00:00" },
          ],
        }),
      }),
    });

    const service = new HelmsmanAgentService({
      llmProvider: {
        generate: async () => {
          generateCount += 1;
          if (generateCount === 1) {
            return {
              model: "test-model",
              text: JSON.stringify({
                type: "tool_call",
                toolName: "shell.execute",
                parameters: { command: "aws s3api list-buckets --output json" },
              }),
            };
          }

          throw new Error("formatter failed");
        },
      },
      toolRegistry: registry,
    });

    const response = await service.handleMessage({
      platform: "telegram",
      chatId: "1",
      messageId: "2",
      userId: "3",
      text: "list buckets",
      timestamp: new Date(),
      correlationId: "corr-8",
    });

    expect(response.status).toBe("success");
    expect(response.text).toContain("I found 2 S3 bucket(s).");
    expect(response.text).not.toContain("{\"Buckets\"");
  });

  it("should return friendly error for aws invalid choice", async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "shell.execute",
        description: "shell executor",
        parameters: { command: "string" },
        riskTier: "read_only",
      },
      execute: async (): Promise<ToolExecutionResult> => ({
        success: false,
        output: "",
        error: "aws: error: argument operation: Invalid choice, valid choices are: get-distribution list-distributions",
      }),
    });

    const service = new HelmsmanAgentService({
      llmProvider: {
        generate: async () => ({
          model: "test-model",
          text: JSON.stringify({
            type: "tool_call",
            toolName: "shell.execute",
            parameters: { command: "aws cloudfront describe-distribution --id E123" },
          }),
        }),
      },
      toolRegistry: registry,
    });

    const response = await service.handleMessage({
      platform: "telegram",
      chatId: "1",
      messageId: "2",
      userId: "3",
      text: "show distribution",
      timestamp: new Date(),
      correlationId: "corr-9",
    });

    expect(response.status).toBe("error");
    expect(response.text.toLowerCase()).toContain("command was not valid");
    expect(response.text).not.toContain("valid choices are");
  });

  it("should include prior turns in memory for follow-up messages", async () => {
    const seenMessages: string[][] = [];

    const service = new HelmsmanAgentService({
      llmProvider: {
        generate: async (params) => {
          seenMessages.push(params.messages.map((message) => `${message.role}:${message.content}`));
          if (seenMessages.length === 1) {
            return {
              model: "test-model",
              text: "My name is Helmsman.",
            };
          }

          return {
            model: "test-model",
            text: "You told me your name earlier.",
          };
        },
      },
    });

    await service.handleMessage({
      platform: "telegram",
      chatId: "chat-1",
      messageId: "message-1",
      userId: "user-1",
      text: "Remember your name is Helmsman",
      timestamp: new Date(),
      correlationId: "corr-memory-1",
    });

    const followUpResponse = await service.handleMessage({
      platform: "telegram",
      chatId: "chat-1",
      messageId: "message-2",
      userId: "user-1",
      text: "What is your name?",
      timestamp: new Date(),
      correlationId: "corr-memory-2",
    });

    expect(seenMessages).toHaveLength(2);
    expect(seenMessages[1]).toContain("user:Remember your name is Helmsman");
    expect(seenMessages[1]).toContain("assistant:My name is Helmsman.");
    expect(seenMessages[1]).toContain("user:What is your name?");
    expect(followUpResponse.text).toContain("name");
  });

});
