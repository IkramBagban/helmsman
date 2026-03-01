import { z } from "zod";
import type { GitHubClient } from "../github-client.js";
import { createGitHubTool } from "../tool-factory.js";

const ParamsSchema = z.object({
  query: z.string().min(1).describe("GitHub search query string."),
  sort: z.enum(["stars", "forks", "help-wanted-issues", "updated"]).optional().describe("Optional repository sort key."),
  order: z.enum(["asc", "desc"]).default("desc").describe("Sort order for results."),
  perPage: z.number().int().min(1).max(30).default(10).describe("Results per page."),
  page: z.number().int().min(1).default(1).describe("Pagination page number."),
});

export const createSearchReposTool = (client: GitHubClient) =>
  createGitHubTool({
    name: "github.search.repos",
    description: "Search GitHub repositories.",
    category: "github",
    riskTier: "read_only",
    paramsSchema: ParamsSchema,
    execute: async params => {
      const result = await client.octokit.search.repos({ q: params.query, sort: params.sort, order: params.order, per_page: params.perPage, page: params.page });
      return result.data.items.map(repo => ({
        fullName: repo.full_name,
        description: repo.description,
        url: repo.html_url,
        stars: repo.stargazers_count,
      }));
    },
  });
