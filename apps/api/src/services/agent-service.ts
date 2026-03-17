import {
  createHelmsman,
  type CapabilityStore,
  InMemoryCapabilityStore,
  type HelmsmanOrchestrator,
} from "@helmsman/agent-core";
import { SchedulingService, createSchedulingTools, type ScheduleMessageSender } from "@helmsman/scheduling";
import { type NormalizedMessage, type AgentResponse } from "@helmsman/shared";
import { type ApiEnv, hasCloudflareDnsConfig, hasNamecheapDnsConfig } from "../config.js";

export interface AgentService {
  handleMessage(message: NormalizedMessage): Promise<AgentResponse>;
  registerSender(platform: string, sender: ScheduleMessageSender): void;
  getOrchestrator(): HelmsmanOrchestrator;
  getSchedulingService(): SchedulingService;
  startSchedules(): Promise<void>;
}

export class CompositeSender implements ScheduleMessageSender {
  private senders = new Map<string, ScheduleMessageSender>();

  register(platform: string, sender: ScheduleMessageSender) {
    this.senders.set(platform, sender);
  }

  async sendTyping(chatId: string, platform?: string): Promise<void> {
    const sender = platform ? this.senders.get(platform) : null;
    if (sender) {
      await sender.sendTyping(chatId, platform);
    }
  }

  async sendResponse(chatId: string, text: string, platform?: string): Promise<void> {
    const sender = platform ? this.senders.get(platform) : null;
    if (sender) {
      await sender.sendResponse(chatId, text, platform);
    } else {
      console.warn(`No sender registered for platform: ${platform}. Dropping message for ${chatId}.`);
    }
  }
}

export class CoreAgentService implements AgentService {
  private orchestrator!: HelmsmanOrchestrator;
  private schedulingService!: SchedulingService;
  private readonly compositeSender = new CompositeSender();

  constructor(
    private readonly env: ApiEnv,
    private readonly capabilityStore: CapabilityStore = new InMemoryCapabilityStore()
  ) {}

  async initialize() {
    // ── Bootstrap scheduling service ────────────────────────────────────────
    this.schedulingService = new SchedulingService({
      dataDir: this.env.scheduleDataDir,
      sender: this.compositeSender,
      // Orchestrator set via proxy to handle circular dependency
      orchestrator: new Proxy({} as HelmsmanOrchestrator, {
        get: (_target, prop, receiver) => {
          if (!this.orchestrator) throw new Error("Orchestrator not yet initialized");
          return Reflect.get(this.orchestrator, prop, receiver);
        },
      }),
    });

    const schedulingTools = createSchedulingTools({ schedulingService: this.schedulingService });

    // ── Determine LLM Model ─────────────────────────────────────────────────
    let model = "google/gemini-2.0-flash";
    if (this.env.llmProvider === "anthropic") {
      model = "anthropic/claude-sonnet-4-6";
    } else if (this.env.llmProvider === "openai") {
      model = "openai/gpt-4o";
    }

    // ── Bootstrap orchestrator ──────────────────────────────────────────────
    this.orchestrator = await createHelmsman({
      model,
      githubToken: process.env.GITHUB_TOKEN,
      githubBaseUrl: process.env.GITHUB_API_BASE_URL,
      enableDevopsTools: true,
      awsKnowledgeMcpUrl: this.env.awsKnowledgeMcpUrl,
      awsKnowledgeMcpApiKey: this.env.awsKnowledgeMcpApiKey,
      awsKnowledgeMcpTimeoutMs: this.env.awsKnowledgeMcpTimeoutMs,
      capabilityStore: this.capabilityStore,
      dnsConfig: hasCloudflareDnsConfig(this.env)
        ? {
            provider: "cloudflare",
            cloudflare: {
              apiToken: this.env.cloudflareApiToken as string,
              zoneMap: this.env.cloudflareZoneMap,
              apiBaseUrl: this.env.cloudflareApiBaseUrl,
            },
          }
        : hasNamecheapDnsConfig(this.env)
          ? {
              provider: "namecheap",
              namecheap: {
                apiUser: this.env.namecheapApiUser as string,
                apiKey: this.env.namecheapApiKey as string,
                username: this.env.namecheapUsername as string,
                clientIp: this.env.namecheapClientIp as string,
                apiBaseUrl: this.env.namecheapApiBaseUrl,
              },
            }
          : undefined,
      extraTools: schedulingTools,
    });
  }

  async startSchedules() {
    await this.schedulingService.start();
  }

  registerSender(platform: string, sender: ScheduleMessageSender) {
    this.compositeSender.register(platform, sender);
  }

  async handleMessage(message: NormalizedMessage): Promise<AgentResponse> {
    return this.orchestrator.handleMessage(message);
  }

  getSchedulingService() {
    return this.schedulingService;
  }

  getOrchestrator() {
    return this.orchestrator;
  }
}
