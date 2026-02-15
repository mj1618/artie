import { WebContainer, FileSystemTree, DirectoryNode } from "@webcontainer/api";

/**
 * Remove specific file paths from a WebContainer file tree.
 * Paths should be relative (e.g. "src/app/page.tsx").
 */
export function removePathsFromTree(
  tree: FileSystemTree,
  paths: Set<string>,
): FileSystemTree {
  const result: FileSystemTree = {};

  for (const [name, node] of Object.entries(tree)) {
    if ("file" in node) {
      // It's a file node — check if its path is in the skip set
      if (!paths.has(name)) {
        result[name] = node;
      }
    } else if ("directory" in node) {
      // Recurse into directories, filtering by prefixed paths
      const dirNode = node as DirectoryNode;
      const childPaths = new Set<string>();
      for (const p of paths) {
        if (p.startsWith(name + "/")) {
          childPaths.add(p.slice(name.length + 1));
        }
      }
      const filteredChildren = removePathsFromTree(
        dirNode.directory,
        childPaths,
      );
      // Only include directory if it still has children or no children were filtered
      if (Object.keys(filteredChildren).length > 0 || childPaths.size === 0) {
        result[name] = { directory: filteredChildren };
      }
    }
  }

  return result;
}

/**
 * Load a file tree into the WebContainer filesystem.
 */
export async function loadFiles(
  container: WebContainer,
  files: FileSystemTree,
): Promise<void> {
  await container.mount(files);
}

/**
 * Write a single file to the WebContainer filesystem.
 * Creates parent directories if they don't exist.
 */
export async function writeFile(
  container: WebContainer,
  path: string,
  content: string,
): Promise<void> {
  const dir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : null;
  if (dir) {
    await container.fs.mkdir(dir, { recursive: true });
  }
  await container.fs.writeFile(path, content);
}

/**
 * Read a file from the WebContainer filesystem.
 */
export async function readFile(
  container: WebContainer,
  path: string,
): Promise<string> {
  return await container.fs.readFile(path, "utf-8");
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

const SKIP_DIRS = ["node_modules", ".git", ".next", "dist", ".convex"];

/**
 * Recursively read directory structure from the WebContainer filesystem.
 */
export async function readDirectory(
  container: WebContainer,
  dirPath: string = ".",
  skipDirs: string[] = SKIP_DIRS,
): Promise<FileTreeNode[]> {
  const entries = await container.fs.readdir(dirPath, {
    withFileTypes: true,
  });
  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    const fullPath =
      dirPath === "." ? entry.name : `${dirPath}/${entry.name}`;

    if (entry.isDirectory()) {
      if (skipDirs.includes(entry.name)) continue;
      const children = await readDirectory(container, fullPath, skipDirs);
      nodes.push({
        name: entry.name,
        path: fullPath,
        type: "directory",
        children,
      });
    } else {
      nodes.push({ name: entry.name, path: fullPath, type: "file" });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
