import { AppError } from "@helmsman/shared";
import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";

export interface GitHubClientOptions {
  readonly token?: string;
  readonly baseUrl?: string;
}

export interface GitHubClient {
  readonly isAuthenticated: boolean;
  readonly octokit: Octokit;
  readonly graphqlWithAuth: typeof graphql;
}

export const createGitHubClient = (options: GitHubClientOptions = {}): GitHubClient => {
  const octokit = new Octokit({ auth: options.token, baseUrl: options.baseUrl || "https://api.github.com" });
  const graphqlWithAuth = graphql.defaults({
    baseUrl: options.baseUrl || "https://api.github.com",
    headers: options.token ? { authorization: `token ${options.token}` } : undefined,
  });

  return {
    isAuthenticated: Boolean(options.token),
    octokit,
    graphqlWithAuth,
  };
};

export const ensureAuthenticated = (client: GitHubClient, toolName: string): void => {
  if (!client.isAuthenticated) {
    throw new AppError("GITHUB.AUTH_REQUIRED", `${toolName} requires a GitHub token for authenticated access.`);
  }
};
