import { createHighlighter, type BundledLanguage, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: [
        "typescript",
        "javascript",
        "tsx",
        "jsx",
        "json",
        "css",
        "html",
        "markdown",
        "yaml",
        "toml",
        "bash",
        "python",
        "rust",
        "go",
      ],
    });
  }
  return highlighterPromise;
}

const EXTENSION_TO_LANG: Record<string, BundledLanguage> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".json": "json",
  ".css": "css",
  ".html": "html",
  ".htm": "html",
  ".md": "markdown",
  ".mdx": "markdown",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".sh": "bash",
  ".bash": "bash",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".mts": "typescript",
  ".cts": "typescript",
};

export function getLangFromPath(path: string): BundledLanguage | null {
  const ext = path.substring(path.lastIndexOf(".")).toLowerCase();
  return EXTENSION_TO_LANG[ext] ?? null;
}
