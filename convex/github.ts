"use node";

import { v } from "convex/values";
import { action, internalAction, ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Octokit } from "@octokit/rest";
import { Id } from "./_generated/dataModel";

const SKIP_PATTERNS = [
  /^node_modules\//,
  /^\.git\//,
  /^dist\//,
  /^build\//,
  /^\.next\//,
  // Keep lockfiles - needed for efficient pnpm installs
];

const MAX_FILE_SIZE = 16 * 1024 * 1024; // 16 MiB
const BATCH_SIZE = 20;

function createOctokit(token?: string) {
  return new Octokit({
    auth: token || process.env.GITHUB_TOKEN,
  });
}

/**
 * Refresh GitHub access token using refresh token.
 * Returns new access token, refresh token, and expiry timestamp.
 */
async function refreshGithubToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
} | null> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[refreshGithubToken] Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET");
    return null;
  }

  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("[refreshGithubToken] GitHub error:", data.error, data.error_description);
      return null;
    }

    if (!data.access_token) {
      console.error("[refreshGithubToken] No access_token in response");
      return null;
    }

    // expires_in is in seconds
    const expiresAt = data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: expiresAt ?? Date.now() + 8 * 60 * 60 * 1000, // Default 8 hours if not provided
    };
  } catch (err) {
    console.error("[refreshGithubToken] Failed to refresh token:", err);
    return null;
  }
}

/**
 * Get the user's GitHub token, refreshing if expired.
 * Returns undefined if no token available.
 * Throws an error if token refresh fails (user needs to reconnect).
 */
async function getUserGithubToken(ctx: ActionCtx): Promise<string | undefined> {
  const profile = await ctx.runQuery(api.users.getProfile);

  if (!profile?.githubAccessToken) {
    return undefined;
  }

  // Check if token is expired (with 5 minute buffer)
  const expiresAt = profile.githubTokenExpiresAt;
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (expiresAt && Date.now() > expiresAt - bufferMs) {
    console.log("[getUserGithubToken] Token expired or expiring soon, attempting refresh");

    if (!profile.githubRefreshToken) {
      console.warn("[getUserGithubToken] No refresh token available");
      throw new Error(
        "Your GitHub connection has expired. Please reconnect your GitHub account in Settings.",
      );
    }

    const newTokens = await refreshGithubToken(profile.githubRefreshToken);

    if (!newTokens) {
      console.error("[getUserGithubToken] Failed to refresh token");
      // Clear the invalid tokens so user knows to reconnect
      await ctx.runMutation(api.users.disconnectGithub);
      throw new Error(
        "Your GitHub connection has expired and could not be refreshed. Please reconnect your GitHub account in Settings.",
      );
    }

    // Update the stored tokens
    await ctx.runMutation(api.users.updateGithubTokens, {
      githubAccessToken: newTokens.accessToken,
      githubRefreshToken: newTokens.refreshToken,
      githubTokenExpiresAt: newTokens.expiresAt,
    });

    console.log("[getUserGithubToken] Token refreshed successfully");
    return newTokens.accessToken;
  }

  return profile.githubAccessToken;
}

function shouldSkip(path: string, size?: number): boolean {
  if (SKIP_PATTERNS.some((p) => p.test(path))) return true;
  if (size && size > MAX_FILE_SIZE) return true;
  return false;
}

interface RepoInfo {
  githubOwner: string;
  githubRepo: string;
  defaultBranch: string;
  pushStrategy: "direct" | "pr";
}

async function getRepo(ctx: ActionCtx, repoId: Id<"repos">): Promise<RepoInfo> {
  const repo = await ctx.runQuery(api.projects.get, { repoId });
  if (!repo) throw new Error("Repository not found");
  return {
    githubOwner: repo.githubOwner,
    githubRepo: repo.githubRepo,
    defaultBranch: repo.defaultBranch,
    pushStrategy: repo.pushStrategy,
  };
}

async function fetchFileBatch(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
  paths: string[],
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  const fetched = await Promise.all(
    paths.map(async (path) => {
      try {
        const { data } = await octokit.repos.getContent({
          owner,
          repo,
          path,
          ref,
        });
        if ("content" in data && data.encoding === "base64") {
          return {
            path,
            content: Buffer.from(data.content, "base64").toString("utf-8"),
          };
        }
        // File exists but content not available or wrong encoding
        console.warn(
          `[fetchFileBatch] Skipping file (no base64 content): ${path}`,
          "content" in data ? `encoding=${data.encoding}` : "no content field",
        );
        return null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[fetchFileBatch] Failed to fetch file: ${path}`, message);
        return null;
      }
    }),
  );
  for (const result of fetched) {
    if (result) {
      results[result.path] = result.content;
    }
  }
  return results;
}

export const listUserRepos = action({
  args: {},
  handler: async (ctx) => {
    const token = await getUserGithubToken(ctx);
    if (!token) {
      throw new Error(
        "GitHub account not connected. Please connect your GitHub account in Settings first.",
      );
    }
    const octokit = createOctokit(token);

    const { data } = await octokit.repos.listForAuthenticatedUser({
      sort: "updated",
      per_page: 100,
      affiliation: "owner,collaborator,organization_member",
    });

    return data.map((repo) => ({
      fullName: repo.full_name,
      owner: repo.owner?.login ?? "",
      name: repo.name,
      description: repo.description ?? "",
      defaultBranch: repo.default_branch ?? "main",
      private: repo.private,
      updatedAt: repo.updated_at ?? "",
    }));
  },
});

export const fetchRepoTree = action({
  args: {
    repoId: v.id("repos"),
  },
  handler: async (ctx, args) => {
    const repo = await getRepo(ctx, args.repoId);
    const token = await getUserGithubToken(ctx);
    const octokit = createOctokit(token);

    const { data } = await octokit.git.getTree({
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      tree_sha: repo.defaultBranch,
      recursive: "1",
    });

    const files = data.tree
      .filter((item) => {
        if (!item.path) return false;
        return !shouldSkip(item.path, item.size ?? undefined);
      })
      .map((item) => ({
        path: item.path!,
        type: item.type as "blob" | "tree",
        size: item.size ?? 0,
        sha: item.sha!,
      }));

    return files;
  },
});

export const fetchFileContents = action({
  args: {
    repoId: v.id("repos"),
    paths: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const repo = await getRepo(ctx, args.repoId);
    const token = await getUserGithubToken(ctx);
    const octokit = createOctokit(token);
    const results: Record<string, string> = {};

    for (let i = 0; i < args.paths.length; i += BATCH_SIZE) {
      const batch = args.paths.slice(i, i + BATCH_SIZE);
      const batchResults = await fetchFileBatch(
        octokit,
        repo.githubOwner,
        repo.githubRepo,
        repo.defaultBranch,
        batch,
      );
      Object.assign(results, batchResults);
    }

    return results;
  },
});

export const fetchRepoForWebContainer = action({
  args: {
    repoId: v.id("repos"),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const repo = await getRepo(ctx, args.repoId);
    const token = await getUserGithubToken(ctx);
    const octokit = createOctokit(token);

    let targetBranch = args.branch ?? repo.defaultBranch;

    console.log(
      `[fetchRepoForWebContainer] Fetching ${repo.githubOwner}/${repo.githubRepo}@${targetBranch}`,
    );
    console.log(
      `[fetchRepoForWebContainer] Using token: ${token ? "yes (length: " + token.length + ")" : "no (using GITHUB_TOKEN env var)"}`,
    );

    // Helper to resolve branch name to commit SHA (ensures we get latest, not cached)
    const resolveCommitSha = async (branch: string): Promise<string> => {
      const { data: refData } = await octokit.git.getRef({
        owner: repo.githubOwner,
        repo: repo.githubRepo,
        ref: `heads/${branch}`,
      });
      return refData.object.sha;
    };

    // 1. Get the tree - if requested branch doesn't exist, fall back to default
    // We resolve branch to commit SHA first to avoid GitHub API caching issues
    let treeData;
    try {
      const commitSha = await resolveCommitSha(targetBranch);
      console.log(
        `[fetchRepoForWebContainer] Resolved ${targetBranch} to commit ${commitSha.slice(0, 7)}`,
      );
      const response = await octokit.git.getTree({
        owner: repo.githubOwner,
        repo: repo.githubRepo,
        tree_sha: commitSha,
        recursive: "1",
      });
      treeData = response.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // If requested branch doesn't exist on GitHub, fall back to default branch
      // This happens when a session is created with a new branch that hasn't been pushed yet
      if (targetBranch !== repo.defaultBranch && message.includes("Not Found")) {
        console.log(
          `[fetchRepoForWebContainer] Branch '${targetBranch}' not found on GitHub, falling back to default branch '${repo.defaultBranch}'`,
        );
        targetBranch = repo.defaultBranch;
        try {
          const fallbackCommitSha = await resolveCommitSha(repo.defaultBranch);
          console.log(
            `[fetchRepoForWebContainer] Resolved ${repo.defaultBranch} to commit ${fallbackCommitSha.slice(0, 7)}`,
          );
          const fallbackResponse = await octokit.git.getTree({
            owner: repo.githubOwner,
            repo: repo.githubRepo,
            tree_sha: fallbackCommitSha,
            recursive: "1",
          });
          treeData = fallbackResponse.data;
        } catch (fallbackErr) {
          const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          console.error(
            `[fetchRepoForWebContainer] Failed to get tree for default branch ${repo.githubOwner}/${repo.githubRepo}@${repo.defaultBranch}:`,
            fallbackMessage,
          );
          throw new Error(
            `Repository ${repo.githubOwner}/${repo.githubRepo} not found or you don't have access to it. ` +
            `Branch: ${repo.defaultBranch}. Error: ${fallbackMessage}`,
          );
        }
      } else {
        console.error(
          `[fetchRepoForWebContainer] Failed to get tree for ${repo.githubOwner}/${repo.githubRepo}@${targetBranch}:`,
          message,
        );
        throw new Error(
          `Repository ${repo.githubOwner}/${repo.githubRepo} not found or you don't have access to it. ` +
          `Branch: ${targetBranch}. Error: ${message}`,
        );
      }
    }

    const allBlobs = treeData.tree.filter(
      (item) => item.type === "blob" && item.path,
    );
    const skippedFiles: { path: string; reason: string }[] = [];

    const filePaths = allBlobs
      .filter((item) => {
        const path = item.path!;
        const size = item.size ?? undefined;

        // Check each skip reason individually for better logging
        for (const pattern of SKIP_PATTERNS) {
          if (pattern.test(path)) {
            skippedFiles.push({ path, reason: `matches pattern ${pattern}` });
            return false;
          }
        }
        if (size && size > MAX_FILE_SIZE) {
          skippedFiles.push({
            path,
            reason: `exceeds max size (${size} > ${MAX_FILE_SIZE})`,
          });
          return false;
        }
        return true;
      })
      .map((item) => item.path!);

    console.log(
      `[fetchRepoForWebContainer] Tree contains ${allBlobs.length} files, fetching ${filePaths.length}, skipping ${skippedFiles.length}`,
    );
    if (skippedFiles.length > 0 && skippedFiles.length <= 20) {
      console.log(
        `[fetchRepoForWebContainer] Skipped files:`,
        skippedFiles.map((f) => `${f.path} (${f.reason})`).join(", "),
      );
    }

    // 2. Fetch file contents in parallel batches
    const fileContents: Record<string, string> = {};
    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
      const batch = filePaths.slice(i, i + BATCH_SIZE);
      const batchResults = await fetchFileBatch(
        octokit,
        repo.githubOwner,
        repo.githubRepo,
        targetBranch,
        batch,
      );
      Object.assign(fileContents, batchResults);
    }

    const fetchedCount = Object.keys(fileContents).length;
    const failedCount = filePaths.length - fetchedCount;
    if (failedCount > 0) {
      console.warn(
        `[fetchRepoForWebContainer] Failed to fetch ${failedCount} files (see fetchFileBatch errors above)`,
      );
    }
    console.log(
      `[fetchRepoForWebContainer] Successfully fetched ${fetchedCount} files`,
    );

    // 3. Build WebContainer FileSystemTree structure
    const fsTree: Record<string, unknown> = {};

    for (const [filePath, content] of Object.entries(fileContents)) {
      const parts = filePath.split("/");
      let current = fsTree;

      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
          current[parts[i]] = { directory: {} };
        }
        current = (
          current[parts[i]] as { directory: Record<string, unknown> }
        ).directory;
      }

      const fileName = parts[parts.length - 1];
      current[fileName] = { file: { contents: content } };
    }

    // Return metadata about what branch was actually used
    // This helps the frontend decide whether to cache (don't cache fallback results)
    const requestedBranch = args.branch ?? repo.defaultBranch;
    const didFallback = targetBranch !== requestedBranch;

    return {
      files: fsTree,
      resolvedBranch: targetBranch,
      didFallback,
    };
  },
});

// ---- GitHub Write Actions ----

interface FileChange {
  path: string;
  content: string;
}

/**
 * Creates a single commit with multiple file changes using the Git Data API.
 * Returns the commit SHA.
 */
async function createCommitWithFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  files: FileChange[],
  commitMessage: string,
): Promise<{ commitSha: string; commitUrl: string }> {
  // 1. Get the current commit SHA of the branch
  const { data: refData } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  const baseSha = refData.object.sha;

  // 2. Get the base tree
  const { data: baseCommit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  });
  const baseTreeSha = baseCommit.tree.sha;

  // 3. Create blobs for each changed file
  const treeItems = await Promise.all(
    files.map(async (file) => {
      const { data: blob } = await octokit.git.createBlob({
        owner,
        repo,
        content: Buffer.from(file.content, "utf-8").toString("base64"),
        encoding: "base64",
      });
      return {
        path: file.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.sha,
      };
    }),
  );

  // 4. Create a new tree
  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: treeItems,
  });

  // 5. Create the commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message: commitMessage,
    tree: newTree.sha,
    parents: [baseSha],
  });

  // 6. Update the branch ref
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });

  return {
    commitSha: newCommit.sha,
    commitUrl: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`,
  };
}

export const commitToDefault = action({
  args: {
    repoId: v.id("repos"),
    messageId: v.id("messages"),
    fileChangeId: v.id("fileChanges"),
    commitMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const repo = await getRepo(ctx, args.repoId);
    const fileChange = await ctx.runQuery(api.fileChanges.get, {
      fileChangeId: args.fileChangeId,
    });
    if (!fileChange) throw new Error("File changes not found");

    const token = await getUserGithubToken(ctx);
    const octokit = createOctokit(token);

    try {
      const result = await createCommitWithFiles(
        octokit,
        repo.githubOwner,
        repo.githubRepo,
        repo.defaultBranch,
        fileChange.files,
        args.commitMessage,
      );

      await ctx.runMutation(api.messages.markChangesCommitted, {
        messageId: args.messageId,
        commitSha: result.commitSha,
      });

      return result;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      if (message.includes("Update is not a fast forward")) {
        throw new Error(
          "Branch has been updated since files were loaded. Please reload the preview and try again.",
        );
      }
      throw new Error(`Failed to commit: ${message}`);
    }
  },
});

export const commitToBranch = action({
  args: {
    repoId: v.id("repos"),
    messageId: v.id("messages"),
    fileChangeId: v.id("fileChanges"),
    commitMessage: v.string(),
    branchName: v.string(),
    prTitle: v.string(),
    prBody: v.string(),
  },
  handler: async (ctx, args) => {
    const repo = await getRepo(ctx, args.repoId);
    const fileChange = await ctx.runQuery(api.fileChanges.get, {
      fileChangeId: args.fileChangeId,
    });
    if (!fileChange) throw new Error("File changes not found");

    const token = await getUserGithubToken(ctx);
    const octokit = createOctokit(token);

    // 1. Get the default branch HEAD SHA
    const { data: refData } = await octokit.git.getRef({
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      ref: `heads/${repo.defaultBranch}`,
    });
    const headSha = refData.object.sha;

    // 2. Create the new branch
    await octokit.git.createRef({
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      ref: `refs/heads/${args.branchName}`,
      sha: headSha,
    });

    // 3. Commit files to the new branch
    const commitResult = await createCommitWithFiles(
      octokit,
      repo.githubOwner,
      repo.githubRepo,
      args.branchName,
      fileChange.files,
      args.commitMessage,
    );

    // 4. Create the pull request
    const { data: pr } = await octokit.pulls.create({
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      title: args.prTitle,
      body: args.prBody,
      head: args.branchName,
      base: repo.defaultBranch,
    });

    await ctx.runMutation(api.messages.markChangesCommitted, {
      messageId: args.messageId,
      commitSha: commitResult.commitSha,
      prUrl: pr.html_url,
    });

    return {
      commitSha: commitResult.commitSha,
      prUrl: pr.html_url,
      branchName: args.branchName,
    };
  },
});

export const pushChanges = action({
  args: {
    repoId: v.id("repos"),
    messageId: v.id("messages"),
    fileChangeId: v.id("fileChanges"),
    commitMessage: v.optional(v.string()),
    branchName: v.optional(v.string()),
    prTitle: v.optional(v.string()),
    prBody: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    commitSha: string;
    commitUrl?: string;
    prUrl?: string;
    branchName?: string;
  }> => {
    const repo = await getRepo(ctx, args.repoId);
    const message = await ctx.runQuery(api.messages.get, {
      messageId: args.messageId,
    });
    if (!message) throw new Error("Message not found");

    const fileChange = await ctx.runQuery(api.fileChanges.get, {
      fileChangeId: args.fileChangeId,
    });
    if (!fileChange) throw new Error("File changes not found");

    const firstLine: string = message.content.split("\n")[0].slice(0, 72);
    const defaultCommitMessage = `Composure: ${firstLine}`;
    const commitMessage = args.commitMessage ?? defaultCommitMessage;
    const token = await getUserGithubToken(ctx);
    const octokit = createOctokit(token);

    if (repo.pushStrategy === "direct") {
      try {
        const result = await createCommitWithFiles(
          octokit,
          repo.githubOwner,
          repo.githubRepo,
          repo.defaultBranch,
          fileChange.files,
          commitMessage,
        );

        await ctx.runMutation(api.messages.markChangesCommitted, {
          messageId: args.messageId,
          commitSha: result.commitSha,
        });

        return result;
      } catch (error: unknown) {
        const errMsg =
          error instanceof Error ? error.message : "Unknown error";
        if (errMsg.includes("Update is not a fast forward")) {
          throw new Error(
            "Branch has been updated since files were loaded. Please reload the preview and try again.",
          );
        }
        throw new Error(`Failed to commit: ${errMsg}`);
      }
    } else {
      const branchName = args.branchName ?? `composure/${Date.now()}`;
      const prTitle = args.prTitle ?? commitMessage;
      const prBody = args.prBody ?? `## Changes made by Composure\n\n${message.content}\n\n### Files changed\n${fileChange.files.map((f: { path: string }) => `- \`${f.path}\``).join("\n")}`;

      // Get the default branch HEAD SHA
      const { data: refData } = await octokit.git.getRef({
        owner: repo.githubOwner,
        repo: repo.githubRepo,
        ref: `heads/${repo.defaultBranch}`,
      });
      const headSha = refData.object.sha;

      // Create the new branch
      await octokit.git.createRef({
        owner: repo.githubOwner,
        repo: repo.githubRepo,
        ref: `refs/heads/${branchName}`,
        sha: headSha,
      });

      // Commit files to the new branch
      const commitResult = await createCommitWithFiles(
        octokit,
        repo.githubOwner,
        repo.githubRepo,
        branchName,
        fileChange.files,
        commitMessage,
      );

      // Create the pull request
      const { data: pr } = await octokit.pulls.create({
        owner: repo.githubOwner,
        repo: repo.githubRepo,
        title: prTitle,
        body: prBody,
        head: branchName,
        base: repo.defaultBranch,
      });

      await ctx.runMutation(api.messages.markChangesCommitted, {
        messageId: args.messageId,
        commitSha: commitResult.commitSha,
        prUrl: pr.html_url,
      });

      return {
        commitSha: commitResult.commitSha,
        prUrl: pr.html_url,
        branchName,
      };
    }
  },
});

// ---- Pull Request Actions ----

export const listOpenPullRequests = action({
  args: {},
  handler: async (ctx) => {
    const token = await getUserGithubToken(ctx);
    if (!token) {
      throw new Error(
        "GitHub account not connected. Please connect your GitHub account in Settings first.",
      );
    }

    // Get all repos the user has connected
    const repos = await ctx.runQuery(api.projects.listAll);
    if (!repos || repos.length === 0) {
      return [];
    }

    const octokit = createOctokit(token);
    const allPRs: Array<{
      repoId: string;
      repoFullName: string;
      teamName: string;
      prNumber: number;
      title: string;
      body: string;
      author: string;
      authorAvatar: string;
      createdAt: string;
      updatedAt: string;
      headBranch: string;
      baseBranch: string;
      isDraft: boolean;
      htmlUrl: string;
    }> = [];

    // Fetch PRs from each repo in parallel
    const prPromises = repos.map(async (repo) => {
      try {
        const { data: prs } = await octokit.pulls.list({
          owner: repo.githubOwner,
          repo: repo.githubRepo,
          state: "open",
          sort: "updated",
          direction: "desc",
          per_page: 30,
        });

        return prs.map((pr) => ({
          repoId: repo._id,
          repoFullName: `${repo.githubOwner}/${repo.githubRepo}`,
          teamName: repo.teamName ?? "",
          prNumber: pr.number,
          title: pr.title,
          body: pr.body ?? "",
          author: pr.user?.login ?? "unknown",
          authorAvatar: pr.user?.avatar_url ?? "",
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          headBranch: pr.head.ref,
          baseBranch: pr.base.ref,
          isDraft: pr.draft ?? false,
          htmlUrl: pr.html_url,
        }));
      } catch (err) {
        console.error(
          `[listOpenPullRequests] Failed to fetch PRs for ${repo.githubOwner}/${repo.githubRepo}:`,
          err instanceof Error ? err.message : String(err),
        );
        return [];
      }
    });

    const results = await Promise.all(prPromises);
    for (const prs of results) {
      allPRs.push(...prs);
    }

    // Sort all PRs by updated time
    allPRs.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    return allPRs;
  },
});

export const getPullRequestDetail = action({
  args: {
    repoId: v.id("repos"),
    prNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const repo = await getRepo(ctx, args.repoId);
    const token = await getUserGithubToken(ctx);
    const octokit = createOctokit(token);

    // Fetch PR details, files, and reviews in parallel
    const [prResponse, filesResponse, reviewsResponse] = await Promise.all([
      octokit.pulls.get({
        owner: repo.githubOwner,
        repo: repo.githubRepo,
        pull_number: args.prNumber,
      }),
      octokit.pulls.listFiles({
        owner: repo.githubOwner,
        repo: repo.githubRepo,
        pull_number: args.prNumber,
        per_page: 100,
      }),
      octokit.pulls.listReviews({
        owner: repo.githubOwner,
        repo: repo.githubRepo,
        pull_number: args.prNumber,
        per_page: 100,
      }),
    ]);

    const pr = prResponse.data;
    const files = filesResponse.data;
    const reviews = reviewsResponse.data;

    return {
      prNumber: pr.number,
      title: pr.title,
      body: pr.body ?? "",
      state: pr.state,
      author: pr.user?.login ?? "unknown",
      authorAvatar: pr.user?.avatar_url ?? "",
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
      isDraft: pr.draft ?? false,
      mergeable: pr.mergeable,
      mergeableState: pr.mergeable_state ?? "unknown",
      merged: pr.merged,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      htmlUrl: pr.html_url,
      repoFullName: `${repo.githubOwner}/${repo.githubRepo}`,
      files: files.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? "",
        previousFilename: f.previous_filename,
      })),
      reviews: reviews.map((r) => ({
        user: r.user?.login ?? "unknown",
        state: r.state,
        body: r.body ?? "",
        submittedAt: r.submitted_at ?? "",
      })),
    };
  },
});

export const mergePullRequest = action({
  args: {
    repoId: v.id("repos"),
    prNumber: v.number(),
    mergeMethod: v.union(
      v.literal("merge"),
      v.literal("squash"),
      v.literal("rebase"),
    ),
    deleteBranch: v.boolean(),
  },
  handler: async (ctx, args) => {
    const repo = await getRepo(ctx, args.repoId);
    const token = await getUserGithubToken(ctx);
    const octokit = createOctokit(token);

    try {
      // Get PR details first to get the branch name
      const { data: pr } = await octokit.pulls.get({
        owner: repo.githubOwner,
        repo: repo.githubRepo,
        pull_number: args.prNumber,
      });

      // Merge the PR
      const { data: mergeResult } = await octokit.pulls.merge({
        owner: repo.githubOwner,
        repo: repo.githubRepo,
        pull_number: args.prNumber,
        merge_method: args.mergeMethod,
      });

      // Delete branch if requested and it's not the default branch
      if (
        args.deleteBranch &&
        pr.head.ref !== repo.defaultBranch &&
        pr.head.repo?.full_name === `${repo.githubOwner}/${repo.githubRepo}`
      ) {
        try {
          await octokit.git.deleteRef({
            owner: repo.githubOwner,
            repo: repo.githubRepo,
            ref: `heads/${pr.head.ref}`,
          });
        } catch (deleteErr) {
          console.warn(
            `[mergePullRequest] Failed to delete branch ${pr.head.ref}:`,
            deleteErr instanceof Error ? deleteErr.message : String(deleteErr),
          );
        }
      }

      return {
        merged: mergeResult.merged,
        message: mergeResult.message,
        sha: mergeResult.sha,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mergePullRequest] Failed to merge PR:`, message);
      return {
        merged: false,
        message: message,
        sha: null,
      };
    }
  },
});

export const approvePullRequest = action({
  args: {
    repoId: v.id("repos"),
    prNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const repo = await getRepo(ctx, args.repoId);
    const token = await getUserGithubToken(ctx);
    const octokit = createOctokit(token);

    await octokit.pulls.createReview({
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      pull_number: args.prNumber,
      event: "APPROVE",
    });

    return { approved: true };
  },
});

/**
 * Auto-commit file changes to a branch, creating the branch from the default
 * branch if it doesn't exist yet.  After committing, finds or creates a PR
 * for the branch so changes are immediately reviewable on GitHub.
 */
export const autoCommitToBranch = internalAction({
  args: {
    repoId: v.id("repos"),
    messageId: v.id("messages"),
    fileChangeId: v.id("fileChanges"),
    branchName: v.string(),
    commitMessage: v.string(),
    prTitle: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ commitSha: string; prUrl?: string } | null> => {
    const repo = await getRepo(ctx, args.repoId);
    const fileChange = await ctx.runQuery(api.fileChanges.get, {
      fileChangeId: args.fileChangeId,
    });
    if (!fileChange) {
      console.error("[autoCommitToBranch] File change not found:", args.fileChangeId);
      return null;
    }

    const token = await getUserGithubToken(ctx);
    const octokit = createOctokit(token);

    // Ensure the branch exists — create from default branch if missing
    try {
      await octokit.git.getRef({
        owner: repo.githubOwner,
        repo: repo.githubRepo,
        ref: `heads/${args.branchName}`,
      });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        const { data: mainRef } = await octokit.git.getRef({
          owner: repo.githubOwner,
          repo: repo.githubRepo,
          ref: `heads/${repo.defaultBranch}`,
        });
        await octokit.git.createRef({
          owner: repo.githubOwner,
          repo: repo.githubRepo,
          ref: `refs/heads/${args.branchName}`,
          sha: mainRef.object.sha,
        });
        console.log(`[autoCommitToBranch] Created branch ${args.branchName} from ${repo.defaultBranch}`);
      } else {
        throw err;
      }
    }

    const result = await createCommitWithFiles(
      octokit,
      repo.githubOwner,
      repo.githubRepo,
      args.branchName,
      fileChange.files,
      args.commitMessage,
    );

    // Find or create a PR for this branch
    let prUrl: string | undefined;
    try {
      const { data: existingPRs } = await octokit.pulls.list({
        owner: repo.githubOwner,
        repo: repo.githubRepo,
        head: `${repo.githubOwner}:${args.branchName}`,
        base: repo.defaultBranch,
        state: "open",
        per_page: 1,
      });

      if (existingPRs.length > 0) {
        prUrl = existingPRs[0].html_url;
        console.log(`[autoCommitToBranch] Found existing PR: ${prUrl}`);
      } else {
        const title = args.prTitle ?? args.commitMessage;
        const changedFilesList = fileChange.files
          .map((f: { path: string }) => `- \`${f.path}\``)
          .join("\n");
        const body = `## Changes made by Composure\n\n${changedFilesList}`;

        const { data: pr } = await octokit.pulls.create({
          owner: repo.githubOwner,
          repo: repo.githubRepo,
          title,
          body,
          head: args.branchName,
          base: repo.defaultBranch,
        });
        prUrl = pr.html_url;
        console.log(`[autoCommitToBranch] Created PR: ${prUrl}`);
      }
    } catch (prErr) {
      console.error("[autoCommitToBranch] Failed to find/create PR:", prErr);
    }

    await ctx.runMutation(api.messages.markChangesCommitted, {
      messageId: args.messageId,
      commitSha: result.commitSha,
      ...(prUrl ? { prUrl } : {}),
    });

    console.log(`[autoCommitToBranch] Committed ${fileChange.files.length} files to ${args.branchName}: ${result.commitSha.slice(0, 7)}`);
    return { commitSha: result.commitSha, prUrl };
  },
});
