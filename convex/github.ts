"use node";

import { v } from "convex/values";
import { action, ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Octokit } from "@octokit/rest";
import { Id } from "./_generated/dataModel";

const SKIP_PATTERNS = [
  /^node_modules\//,
  /^\.git\//,
  /^dist\//,
  /^build\//,
  /^\.next\//,
  /\.lock$/,
  /package-lock\.json$/,
];

const MAX_FILE_SIZE = 100_000;
const BATCH_SIZE = 20;

function createOctokit(token?: string) {
  return new Octokit({
    auth: token || process.env.GITHUB_TOKEN,
  });
}

async function getUserGithubToken(ctx: ActionCtx): Promise<string | undefined> {
  const profile = await ctx.runQuery(api.users.getProfile);
  return profile?.githubAccessToken ?? undefined;
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
        return null;
      } catch {
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
  },
  handler: async (ctx, args) => {
    const repo = await getRepo(ctx, args.repoId);
    const token = await getUserGithubToken(ctx);
    const octokit = createOctokit(token);

    // 1. Get the tree
    const { data: treeData } = await octokit.git.getTree({
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      tree_sha: repo.defaultBranch,
      recursive: "1",
    });

    const filePaths = treeData.tree
      .filter((item) => {
        if (item.type !== "blob" || !item.path) return false;
        return !shouldSkip(item.path, item.size ?? undefined);
      })
      .map((item) => item.path!);

    // 2. Fetch file contents in parallel batches
    const fileContents: Record<string, string> = {};
    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
      const batch = filePaths.slice(i, i + BATCH_SIZE);
      const batchResults = await fetchFileBatch(
        octokit,
        repo.githubOwner,
        repo.githubRepo,
        repo.defaultBranch,
        batch,
      );
      Object.assign(fileContents, batchResults);
    }

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

    return fsTree;
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
    const defaultCommitMessage = `Artie: ${firstLine}`;
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
      const branchName = args.branchName ?? `artie/${Date.now()}`;
      const prTitle = args.prTitle ?? commitMessage;
      const prBody = args.prBody ?? `## Changes made by Artie\n\n${message.content}\n\n### Files changed\n${fileChange.files.map((f: { path: string }) => `- \`${f.path}\``).join("\n")}`;

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
