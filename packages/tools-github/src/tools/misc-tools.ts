import { AppError } from "@helmsman/shared";
import { z } from "zod";
import { ensureAuthenticated, type GitHubClient } from "../github-client.js";
import { createGitHubTool } from "../tool-factory.js";

const RepoSchema = z.object({
  owner: z.string().min(1).describe("Repository owner."),
  repo: z.string().min(1).describe("Repository name."),
});

export const createGetRepoTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.repo.get",
    description: "Get repository details.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: RepoSchema,
    execute: async p => (await client.octokit.repos.get({ owner: p.owner, repo: p.repo })).data,
  });

export const createGetIssueTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.issues.get",
    description: "Get issue details.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: RepoSchema.extend({
      issueNumber: z.number().int().positive().describe("Issue number."),
      includeComments: z.boolean().default(false).describe("Include issue comments."),
    }),
    execute: async p => {
      const issue = (await client.octokit.issues.get({ owner: p.owner, repo: p.repo, issue_number: p.issueNumber })).data;
      if (!p.includeComments) {
        return issue;
      }
      const comments = await client.octokit.issues.listComments({ owner: p.owner, repo: p.repo, issue_number: p.issueNumber, per_page: 100 });
      return { ...issue, comments: comments.data };
    },
  });

export const createListPrsTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.prs.list",
    description: "List pull requests.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: RepoSchema.extend({
      state: z.enum(["open", "closed", "all"]).default("open").describe("PR state."),
      base: z.string().optional().describe("Base branch."),
      perPage: z.number().int().min(1).max(50).default(20).describe("Results per page."),
      page: z.number().int().min(1).default(1).describe("Page number."),
      sort: z.enum(["created", "updated", "popularity", "long-running"]).default("updated").describe("Sort field."),
      direction: z.enum(["asc", "desc"]).default("desc").describe("Sort direction."),
    }),
    execute: async p => (await client.octokit.pulls.list({ owner: p.owner, repo: p.repo, state: p.state, base: p.base, per_page: p.perPage, page: p.page, sort: p.sort, direction: p.direction })).data,
  });

export const createGetPrTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.prs.get",
    description: "Get pull request details.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: RepoSchema.extend({
      prNumber: z.number().int().positive().describe("Pull request number."),
      includeDiff: z.boolean().default(false).describe("Include unified diff."),
      includeComments: z.boolean().default(false).describe("Include comments."),
      includeReviews: z.boolean().default(false).describe("Include reviews."),
    }),
    execute: async p => {
      const pr = (await client.octokit.pulls.get({ owner: p.owner, repo: p.repo, pull_number: p.prNumber })).data;
      const response: Record<string, unknown> = { ...pr };

      if (p.includeDiff) {
        response.diff = await fetchPrDiff(client, p.owner, p.repo, p.prNumber);
      }
      if (p.includeComments) {
        response.comments = (await client.octokit.pulls.listReviewComments({ owner: p.owner, repo: p.repo, pull_number: p.prNumber, per_page: 100 })).data;
      }
      if (p.includeReviews) {
        response.reviews = (await client.octokit.pulls.listReviews({ owner: p.owner, repo: p.repo, pull_number: p.prNumber, per_page: 100 })).data;
      }

      return response;
    },
  });

export const createGetPrDiffTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.prs.getDiff",
    description: "Get pull request raw diff.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: RepoSchema.extend({ prNumber: z.number().int().positive().describe("Pull request number.") }),
    execute: async p => ({ diff: await fetchPrDiff(client, p.owner, p.repo, p.prNumber) }),
  });

const fetchPrDiff = async (client: GitHubClient, owner: string, repo: string, prNumber: number): Promise<string> => {
  const response = await client.octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    owner,
    repo,
    pull_number: prNumber,
    headers: { accept: "application/vnd.github.v3.diff" },
  });

  if (typeof response.data === "string") {
    return response.data;
  }

  throw new AppError("GITHUB.DIFF_UNAVAILABLE", "Could not load PR diff content.");
};

export const createListPrCommentsTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.prs.listComments",
    description: "List pull request review comments.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: RepoSchema.extend({
      prNumber: z.number().int().positive().describe("Pull request number."),
      perPage: z.number().int().min(1).max(100).default(50).describe("Results per page."),
      page: z.number().int().min(1).default(1).describe("Page number."),
    }),
    execute: async p => (await client.octokit.pulls.listReviewComments({ owner: p.owner, repo: p.repo, pull_number: p.prNumber, per_page: p.perPage, page: p.page })).data,
  });

export const createSearchCodeTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.search.code",
    description: "Search code in repositories.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: z.object({
      query: z.string().min(1).describe("GitHub code search query."),
      perPage: z.number().int().min(1).max(30).default(10).describe("Results per page."),
      page: z.number().int().min(1).default(1).describe("Page number."),
    }),
    execute: async p => {
      ensureAuthenticated(client, "github.search.code");
      return (await client.octokit.search.code({ q: p.query, per_page: p.perPage, page: p.page })).data;
    },
  });

export const createGetFileTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.repo.getFile",
    description: "Get file content.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: RepoSchema.extend({
      path: z.string().min(1).describe("Path within repository."),
      ref: z.string().optional().describe("Branch/tag/SHA reference."),
    }),
    execute: async p => {
      const file = await client.octokit.repos.getContent({ owner: p.owner, repo: p.repo, path: p.path, ref: p.ref });
      if (Array.isArray(file.data) || file.data.type !== "file") {
        throw new AppError("GITHUB.NOT_A_FILE", "Requested path is not a file.");
      }
      const decoded = Buffer.from(file.data.content, "base64").toString("utf8");
      return { ...file.data, contentDecoded: decoded };
    },
  });

export const createListFilesTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.repo.listFiles",
    description: "List files in a repository path.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: RepoSchema.extend({
      path: z.string().default("").describe("Directory path."),
      ref: z.string().optional().describe("Branch/tag/SHA reference."),
      recursive: z.boolean().default(false).describe("List recursively using git tree API."),
    }),
    execute: async p => {
      if (p.recursive) {
        const ref = p.ref ?? (await client.octokit.repos.get({ owner: p.owner, repo: p.repo })).data.default_branch;
        return (await client.octokit.git.getTree({ owner: p.owner, repo: p.repo, tree_sha: ref, recursive: "true" })).data.tree;
      }
      return (await client.octokit.repos.getContent({ owner: p.owner, repo: p.repo, path: p.path || ".", ref: p.ref })).data;
    },
  });

export const createListCommitsTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.commits.list",
    description: "List repository commits.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: RepoSchema.extend({
      sha: z.string().optional().describe("Branch or commit SHA."),
      perPage: z.number().int().min(1).max(100).default(30).describe("Results per page."),
      page: z.number().int().min(1).default(1).describe("Page number."),
    }),
    execute: async p => (await client.octokit.repos.listCommits({ owner: p.owner, repo: p.repo, sha: p.sha, per_page: p.perPage, page: p.page })).data,
  });

export const createGetCommitTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.commits.get",
    description: "Get commit details.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: RepoSchema.extend({ ref: z.string().min(1).describe("Commit SHA or ref.") }),
    execute: async p => (await client.octokit.repos.getCommit({ owner: p.owner, repo: p.repo, ref: p.ref })).data,
  });

export const createListWorkflowsTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.actions.listWorkflows",
    description: "List GitHub Actions workflows.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: RepoSchema.extend({
      perPage: z.number().int().min(1).max(100).default(50).describe("Results per page."),
      page: z.number().int().min(1).default(1).describe("Page number."),
    }),
    execute: async p => (await client.octokit.actions.listRepoWorkflows({ owner: p.owner, repo: p.repo, per_page: p.perPage, page: p.page })).data,
  });

export const createGetWorkflowRunTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.actions.getWorkflowRun",
    description: "Get workflow run details.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: RepoSchema.extend({
      runId: z.number().int().positive().describe("Workflow run ID."),
      includeJobs: z.boolean().default(true).describe("Include jobs."),
    }),
    execute: async p => {
      const run = (await client.octokit.actions.getWorkflowRun({ owner: p.owner, repo: p.repo, run_id: p.runId })).data;
      if (!p.includeJobs) {
        return run;
      }
      const jobs = await client.octokit.actions.listJobsForWorkflowRun({ owner: p.owner, repo: p.repo, run_id: p.runId, per_page: 100 });
      return { ...run, jobs: jobs.data.jobs };
    },
  });

export const createListDiscussionsTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.discussions.list",
    description: "List repository discussions via GraphQL.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: RepoSchema.extend({
      first: z.number().int().min(1).max(50).default(20).describe("Items per page."),
      after: z.string().optional().describe("GraphQL cursor."),
      categoryId: z.string().optional().describe("Discussion category ID."),
    }),
    execute: async p => {
      ensureAuthenticated(client, "github.discussions.list");
      const response = await client.graphqlWithAuth(
        `query($owner:String!, $repo:String!, $first:Int!, $after:String, $categoryId:ID) {
          repository(owner:$owner, name:$repo) {
            discussions(first:$first, after:$after, categoryId:$categoryId) {
              nodes { id number title url createdAt isAnswered answerCount comments { totalCount } author { login } category { name } }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
        { owner: p.owner, repo: p.repo, first: p.first, after: p.after, categoryId: p.categoryId },
      );
      return response;
    },
  });

export const createGetDiscussionTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.discussions.get",
    description: "Get a discussion via GraphQL.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: RepoSchema.extend({ discussionNumber: z.number().int().positive().describe("Discussion number.") }),
    execute: async p => {
      ensureAuthenticated(client, "github.discussions.get");
      return client.graphqlWithAuth(
        `query($owner:String!, $repo:String!, $discussionNumber:Int!) {
          repository(owner:$owner, name:$repo) {
            discussion(number:$discussionNumber) {
              id number title body url createdAt answerChosenAt isAnswered author { login }
              comments(first:100) { nodes { body createdAt author { login } } }
            }
          }
        }`,
        { owner: p.owner, repo: p.repo, discussionNumber: p.discussionNumber },
      );
    },
  });
