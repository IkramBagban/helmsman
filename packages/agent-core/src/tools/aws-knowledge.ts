import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export interface AwsKnowledgeToolConfig {
  readonly endpointUrl: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
}

const DEFAULT_AWS_KNOWLEDGE_MCP_URL = "https://knowledge-mcp.global.api.aws";
const DEFAULT_TIMEOUT_MS = 12_000;

interface AwsKnowledgeNormalized {
  readonly answer: string;
  readonly references: string[];
}

interface JsonRpcResponse {
  readonly result?: unknown;
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
  };
}

function extractString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function extractReferences(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const refs: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const normalized = item.trim();
      if (normalized.length > 0) refs.push(normalized);
      continue;
    }

    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const title = extractString(record.title);
      const url = extractString(record.url);
      const text = extractString(record.text);
      const candidate = [title, url, text].filter((entry): entry is string => Boolean(entry)).join(" — ");
      if (candidate.length > 0) refs.push(candidate);
    }
  }

  return refs;
}

function extractFromObject(input: unknown): AwsKnowledgeNormalized | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;

  const directAnswer =
    extractString(record.answer)
    ?? extractString(record.summary)
    ?? extractString(record.content)
    ?? extractString(record.text)
    ?? extractString(record.message);

  if (directAnswer) {
    return {
      answer: directAnswer,
      references: extractReferences(record.references ?? record.citations ?? record.sources),
    };
  }

  const nestedKeys = ["result", "data", "output", "response"];
  for (const key of nestedKeys) {
    const nested = extractFromObject(record[key]);
    if (nested) {
      return nested;
    }
  }

  const content = record.content;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const contentRecord = content as Record<string, unknown>;
    const resultList = contentRecord.result;
    if (Array.isArray(resultList) && resultList.length > 0) {
      const references = resultList
        .slice(0, 5)
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const entry = item as Record<string, unknown>;
          const title = extractString(entry.title);
          const url = extractString(entry.url);
          const context = extractString(entry.context);
          const summary = [title, url, context].filter((part): part is string => Boolean(part)).join(" — ");
          return summary.length > 0 ? summary : null;
        })
        .filter((item): item is string => Boolean(item));

      const answer = references.length > 0
        ? `Top AWS Knowledge results:\n- ${references.join("\n- ")}`
        : "AWS Knowledge MCP returned matching documentation results.";

      return { answer, references };
    }
  }

  if (Array.isArray(record.content)) {
    const joined = record.content
      .map((chunk) => {
        if (!chunk || typeof chunk !== "object") return null;
        const chunkRecord = chunk as Record<string, unknown>;
        return extractString(chunkRecord.text) ?? extractString(chunkRecord.content);
      })
      .filter((chunk): chunk is string => Boolean(chunk))
      .join("\n");

    if (joined.trim().length > 0) {
      return {
        answer: joined.trim(),
        references: extractReferences(record.references ?? record.citations ?? record.sources),
      };
    }
  }

  return null;
}

export function normalizeAwsKnowledgeResponse(payload: unknown): AwsKnowledgeNormalized {
  const normalized = extractFromObject(payload);

  if (normalized) {
    return normalized;
  }

  return {
    answer: "AWS Knowledge MCP returned data, but no readable answer field was found.",
    references: [],
  };
}

export function createAwsKnowledgeTool(config: AwsKnowledgeToolConfig) {
  const endpointUrl = config.endpointUrl.trim().length > 0
    ? config.endpointUrl
    : DEFAULT_AWS_KNOWLEDGE_MCP_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return createTool({
    id: "aws_knowledge_lookup",
    description: "Query AWS Knowledge MCP for canonical AWS behavior, limits, defaults, and compatibility guidance. Use this for how-AWS-works questions, not live account state.",
    inputSchema: z.object({
      query: z.string().min(3).describe("Natural-language AWS question about service behavior, limits, defaults, compatibility, or best practices"),
      service: z.string().optional().describe("Optional AWS service hint (e.g., ec2, s3, iam)"),
      operation: z.string().optional().describe("Optional API/CLI operation hint (e.g., RunInstances, PutBucketPolicy)"),
      uncertaintyReason: z.string().optional().describe("Why knowledge lookup is needed (e.g., unknown default, uncertain quota, behavior conflict)"),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      answer: z.string(),
      references: z.array(z.string()),
      source: z.enum(["aws_knowledge_mcp", "unavailable"]),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(endpointUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-03-26",
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: `aws-knowledge-${Date.now()}`,
            method: "tools/call",
            params: {
              name: "aws___search_documentation",
              arguments: {
                search_phrase: [
                  input.query,
                  input.service ? `service:${input.service}` : null,
                  input.operation ? `operation:${input.operation}` : null,
                  input.uncertaintyReason ? `context:${input.uncertaintyReason}` : null,
                ].filter((part): part is string => Boolean(part)).join(" | "),
                limit: 5,
              },
            },
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          return {
            ok: false,
            answer: "AWS Knowledge MCP request failed.",
            references: [],
            source: "unavailable" as const,
            error: `HTTP ${response.status}`,
          };
        }

        const rpc = await response.json() as JsonRpcResponse;
        if (rpc.error) {
          return {
            ok: false,
            answer: "AWS Knowledge MCP returned an error.",
            references: [],
            source: "unavailable" as const,
            error: rpc.error.message ?? `code ${String(rpc.error.code ?? "unknown")}`,
          };
        }

        const toolCallResult = (rpc.result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
        const textChunks = Array.isArray(toolCallResult)
          ? toolCallResult
            .map((item) => (item?.type === "text" ? item.text : undefined))
            .filter((chunk): chunk is string => typeof chunk === "string" && chunk.trim().length > 0)
          : [];

        const firstText = textChunks[0];
        const parsedPayload = (() => {
          if (!firstText) return rpc.result as unknown;
          try {
            return JSON.parse(firstText) as unknown;
          } catch {
            return { answer: firstText } as unknown;
          }
        })();

        const normalized = normalizeAwsKnowledgeResponse(parsedPayload);

        return {
          ok: true,
          answer: normalized.answer,
          references: normalized.references,
          source: "aws_knowledge_mcp" as const,
        };
      } catch (error) {
        return {
          ok: false,
          answer: "AWS Knowledge MCP is unavailable. Fall back to live AWS discovery and ask one concise clarification if uncertainty remains.",
          references: [],
          source: "unavailable" as const,
          error: error instanceof Error ? error.message : "unknown error",
        };
      } finally {
        clearTimeout(timeoutHandle);
      }
    },
  });
}
