"use client";

import { useState, useEffect, useRef } from "react";
import { getWebContainer } from "@/lib/webcontainer/index";
import {
  readDirectory,
  readFile,
  type FileTreeNode,
} from "@/lib/webcontainer/files";
import { HighlightedCode } from "@/components/preview/HighlightedCode";

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".svg",
  ".webp",
  ".mp3",
  ".mp4",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".zip",
  ".tar",
  ".gz",
  ".pdf",
]);

function isBinaryFile(path: string): boolean {
  const ext = path.substring(path.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

interface FileExplorerProps {
  containerReady: boolean;
}

function TreeNode({
  node,
  selectedFile,
  expandedDirs,
  onSelectFile,
  onToggleDir,
  depth,
}: {
  node: FileTreeNode;
  selectedFile: string | null;
  expandedDirs: Set<string>;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  depth: number;
}) {
  const isDir = node.type === "directory";
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = node.path === selectedFile;

  return (
    <div>
      <button
        onClick={() => (isDir ? onToggleDir(node.path) : onSelectFile(node.path))}
        className={`flex w-full items-center gap-1 px-2 py-0.5 text-left text-xs font-mono hover:bg-zinc-200 dark:hover:bg-zinc-700 ${
          isSelected
            ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
            : "text-zinc-700 dark:text-zinc-300"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="shrink-0 w-3 text-center text-[10px] text-zinc-400">
          {isDir ? (isExpanded ? "▼" : "▶") : ""}
        </span>
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedFile={selectedFile}
              expandedDirs={expandedDirs}
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileExplorer({ containerReady }: FileExplorerProps) {
  const [fileTree, setFileTree] = useState<FileTreeNode[] | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const fileCacheRef = useRef<Map<string, string>>(new Map());
  const treeLoadedRef = useRef(false);

  useEffect(() => {
    if (!containerReady || treeLoadedRef.current) return;
    treeLoadedRef.current = true;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const container = await getWebContainer();
        const tree = await readDirectory(container);
        if (!cancelled) {
          setFileTree(tree);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setFileTree([]);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [containerReady]);

  const handleSelectFile = async (path: string) => {
    setSelectedFile(path);

    if (isBinaryFile(path)) {
      setFileContent("[Binary file]");
      return;
    }

    const cached = fileCacheRef.current.get(path);
    if (cached !== undefined) {
      setFileContent(cached);
      return;
    }

    setFileLoading(true);
    try {
      const container = await getWebContainer();
      const content = await readFile(container, path);
      fileCacheRef.current.set(path, content);
      setFileContent(content);
    } catch {
      setFileContent("[Error reading file]");
    } finally {
      setFileLoading(false);
    }
  };

  const handleToggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  if (!containerReady) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-zinc-400">Waiting for container...</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-white" />
        <p className="text-xs text-zinc-400">Loading file tree...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* File tree */}
      <div className="w-56 shrink-0 overflow-auto border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
        {fileTree && fileTree.length > 0 ? (
          <div className="py-1">
            {fileTree.map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                selectedFile={selectedFile}
                expandedDirs={expandedDirs}
                onSelectFile={handleSelectFile}
                onToggleDir={handleToggleDir}
                depth={0}
              />
            ))}
          </div>
        ) : (
          <div className="p-3 text-xs text-zinc-400">No files found</div>
        )}
      </div>

      {/* File viewer */}
      <div className="flex flex-1 flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
        {selectedFile ? (
          <>
            <div className="border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
              <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                {selectedFile}
              </span>
            </div>
            {fileLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-white" />
              </div>
            ) : (
              <div className="flex-1 overflow-auto p-0">
                <HighlightedCode code={fileContent ?? ""} filePath={selectedFile} />
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-zinc-400">Select a file to view</p>
          </div>
        )}
      </div>
    </div>
  );
}
