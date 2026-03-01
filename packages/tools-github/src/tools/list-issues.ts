import { z } from "zod";
import type { GitHubClient } from "../github-client.js";
import { createGitHubTool } from "../tool-factory.js";

const ParamsSchema = z.object({
  owner: z.string().min(1).describe("Repository owner."),
  repo: z.string().min(1).describe("Repository name."),
  state: z.enum(["open", "closed", "all"]).default("open").describe("Issue state filter."),
  labels: z.array(z.string().min(1).describe("Label name.")).optional().describe("Optional label filters."),
  assignee: z.string().min(1).optional().describe("Optional assignee filter."),
  sort: z.enum(["created", "updated", "comments"]).default("updated").describe("Issue sort field."),
  direction: z.enum(["asc", "desc"]).default("desc").describe("Sort direction."),
  perPage: z.number().int().min(1).max(50).default(20).describe("Results per page."),
  page: z.number().int().min(1).default(1).describe("Pagination page number."),
});

export const createListIssuesTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.issues.list",
    description: "List repository issues.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: ParamsSchema,
    execute: async params => {
      const result = await client.octokit.issues.listForRepo({
        owner: params.owner,
        repo: params.repo,
        state: params.state,
        labels: params.labels?.join(","),
        assignee: params.assignee,
        sort: params.sort,
        direction: params.direction,
        per_page: params.perPage,
        page: params.page,
      });
      return result.data.map(issue => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        author: issue.user?.login ?? "unknown",
        url: issue.html_url,
        isPullRequest: Boolean(issue.pull_request),
      }));
    },
  });
