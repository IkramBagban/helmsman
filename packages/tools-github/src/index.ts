import type { GitHubClientOptions } from "./github-client.js";
import { createGitHubClient } from "./github-client.js";
import type { GitHubTool } from "./types.js";
import {
  createGetCommitTool,
  createGetDiscussionTool,
  createGetFileTool,
  createGetIssueTool,
  createGetPrDiffTool,
  createGetPrTool,
  createGetRepoTool,
  createGetWorkflowRunTool,
  createListCommitsTool,
  createListDiscussionsTool,
  createListFilesTool,
  createListPrCommentsTool,
  createListPrsTool,
  createListWorkflowsTool,
  createSearchCodeTool,
} from "./tools/misc-tools.js";
import { createListIssuesTool } from "./tools/list-issues.js";
import { createSearchReposTool } from "./tools/search-repos.js";

export * from "./types.js";
export * from "./github-client.js";

export const createGitHubTools = (options: GitHubClientOptions = {}): readonly GitHubTool<unknown>[] => {
  const client = createGitHubClient(options);
  return [
    createSearchReposTool(client),
    createGetRepoTool(client),
    createListIssuesTool(client),
    createGetIssueTool(client),
    createListPrsTool(client),
    createGetPrTool(client),
    createGetPrDiffTool(client),
    createListPrCommentsTool(client),
    createListDiscussionsTool(client),
    createGetDiscussionTool(client),
    createGetFileTool(client),
    createListFilesTool(client),
    createSearchCodeTool(client),
    createListCommitsTool(client),
    createGetCommitTool(client),
    createListWorkflowsTool(client),
    createGetWorkflowRunTool(client),
  ] as const as readonly GitHubTool<unknown>[];
};
