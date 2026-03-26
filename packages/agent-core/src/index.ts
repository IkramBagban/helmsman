// ---------------------------------------------------------------------------
// Mastra-based architecture (primary)
// ---------------------------------------------------------------------------

export { createHelmsman, type HelmsmanFactoryConfig } from "./mastra.js";
export { HelmsmanOrchestrator, type HelmsmanConfig } from "./orchestrator.js";
export {
  InMemoryCapabilityStore,
  type CapabilityStore,
  type CapabilityRole,
  type PendingActionRecord,
  type RoleState,
  type PendingActivation,
} from "./capability-store.js";

// Agents
export {
  createDevOpsAgent,
  DEVOPS_AGENT_INSTRUCTIONS,
  type DevOpsAgentConfig,
} from "./agents/devops-agent.js";
export {
  createRouterAgent,
  classifyIntent,
  IntentClassificationSchema,
  ROUTER_INSTRUCTIONS,
  type IntentClassification,
  type RouterConfig,
} from "./agents/router.js";
export {
  createPlannerAgent,
  generatePlan,
  PlanSchema,
  PlanStepSchema,
  type Plan,
  type PlanStep,
  type PlannerConfig,
} from "./agents/planner.js";
export {
  createResponderAgent,
  formatResponse,
  RESPONDER_INSTRUCTIONS,
  type ResponderConfig,
} from "./agents/responder.js";

// Tools (Mastra wrappers)
export {
  shellExecuteTool,
  classifyShellCommandRisk,
} from "./tools/shell-execute.js";
export {
  createAwsKnowledgeTool,
  normalizeAwsKnowledgeResponse,
  type AwsKnowledgeToolConfig,
} from "./tools/aws-knowledge.js";
export {
  createMastraGitHubTools,
  wrapTypedTool,
  type GitHubToolsOptions,
} from "./tools/github-tools.js";
export {
  createMastraDevopsTools,
  type DevopsToolsOptions,
} from "./tools/devops-tools.js";
export { skillReadTool } from "./tools/skill-read.js";

export {
  buildSkillContext,
  selectSkillsForMessage,
  SKILL_CATALOG,
  MAX_DYNAMIC_SKILLS,
} from "./skills/index.js";
export type { SkillDefinition, SelectedSkill } from "./skills/index.js";

// Workflow
export {
  infraWorkflow,
  approvalStep,
  executeStep,
  type InfraWorkflowInput,
  type InfraWorkflowOutput,
} from "./workflows/infra-workflow.js";

// ---------------------------------------------------------------------------
// Legacy exports (deprecated — kept for backward compatibility)
// ---------------------------------------------------------------------------

export { HelmsmanAgentService } from "./agent/agent-service.js";
export { InMemoryConversationMemoryStore } from "./agent/conversation-memory.js";
export type { ConversationMemoryStore } from "./agent/conversation-memory.js";
export type { AgentService } from "./agent/agent-service.js";
export {
  buildSystemPrompt,
  HELMSMAN_SYSTEM_PROMPT,
} from "./agent/system-prompt.js";
export { createLLMProvider } from "./llm/provider-factory.js";
export type { LLMFactoryConfig } from "./llm/provider-factory.js";
export type {
  LLMGenerateParams,
  LLMMessage,
  LLMProvider,
  LLMResponse,
} from "./llm/provider.js";
