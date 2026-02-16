"use client";

import { useEffect, useState } from "react";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackPreview as SandpackPreviewPane,
  SandpackFileExplorer,
  SandpackCodeEditor,
  SandpackConsole,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { useAction, useQuery, ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useParams, useSearchParams } from "next/navigation";

type SandpackFiles = Record<string, { code: string }>;

// Convert WebContainer FileSystemTree to flat Sandpack files
function flattenFileSystemTree(
  tree: Record<string, unknown>,
  prefix = "",
): SandpackFiles {
  const files: SandpackFiles = {};

  for (const [name, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}/${name}` : name;
    const node = value as { file?: { contents: string }; directory?: Record<string, unknown> };

    if (node.file) {
      files[`/${path}`] = { code: node.file.contents };
    } else if (node.directory) {
      Object.assign(files, flattenFileSystemTree(node.directory, path));
    }
  }

  return files;
}

// Filter out files that can cause bundler issues
function filterFilesForSandpack(files: SandpackFiles): SandpackFiles {
  const filtered: SandpackFiles = {};
  const binaryExtensions = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".svg", ".mp3", ".mp4", ".webm", ".pdf"];
  const excludePatterns = [
    /node_modules/,
    /\.lock$/,
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    /\.git\//,
    /\.next\//,
    /dist\//,
    /build\//,
    /\.env/,
    /vite\.config\.(js|ts)$/, // Vite config not needed for Sandpack bundler
  ];
  
  for (const [path, file] of Object.entries(files)) {
    if (excludePatterns.some(p => p.test(path))) continue;
    if (binaryExtensions.some(ext => path.toLowerCase().endsWith(ext))) continue;
    if (file.code.length > 100 * 1024) continue;
    
    // Transform Vite-specific code for Sandpack compatibility
    let code = file.code;
    
    // Replace import.meta.env with process.env (Sandpack supports this)
    code = code.replace(/import\.meta\.env\.(\w+)/g, "process.env.$1");
    code = code.replace(/import\.meta\.env/g, "process.env");
    
    filtered[path] = { code };
  }
  
  return filtered;
}

// Sandpack templates
// - Standard bundler is fast and reliable for React/vanilla projects
// - Nodebox is slow and has limitations (e.g., esbuild-wasm issues with Vite)
// - Vite projects should NOT use the built-in React template because Vite uses
//   index.html as the entry point with <script type="module" src="/src/main.tsx">
type SandpackTemplate = "react" | "react-ts" | "vanilla" | "vanilla-ts" | "static" | "node";

interface TemplateInfo {
  template: SandpackTemplate;
  useNodebox: boolean;
  entryPoint?: string;
  isVite?: boolean;
}

// Find the React entry point in the project
function findReactEntryPoint(files: SandpackFiles): string | undefined {
  // Common Vite entry points
  const viteEntries = ["/src/main.tsx", "/src/main.jsx", "/src/main.ts", "/src/main.js"];
  // Common CRA entry points
  const craEntries = ["/src/index.tsx", "/src/index.jsx", "/src/index.ts", "/src/index.js"];
  // All possible entries
  const allEntries = [...viteEntries, ...craEntries];
  
  for (const entry of allEntries) {
    if (entry in files) {
      return entry;
    }
  }
  return undefined;
}

// Find the index.html entry point for static sites
function findStaticEntryPoint(files: SandpackFiles): string {
  // Check common locations in order of preference
  const locations = ["/index.html", "/public/index.html", "/src/index.html"];
  for (const loc of locations) {
    if (loc in files) {
      return loc;
    }
  }
  // Fallback - look for any index.html
  const indexFile = Object.keys(files).find(p => p.endsWith("/index.html") || p === "/index.html");
  return indexFile ?? "/index.html";
}

// Check if project uses Vite by looking at dependencies and scripts
function isViteProject(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> }): boolean {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts || {};
  
  // Check for vite in dependencies
  if (deps.vite) return true;
  
  // Check for vite in scripts (e.g., "dev": "vite", "build": "vite build")
  const scriptValues = Object.values(scripts).join(" ");
  if (/\bvite\b/.test(scriptValues)) return true;
  
  return false;
}

function detectTemplate(files: SandpackFiles): TemplateInfo {
  const hasPackageJson = "/package.json" in files;
  const hasTsConfig = "/tsconfig.json" in files;
  const hasIndexHtml = "/index.html" in files;
  
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(files["/package.json"].code);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const scripts = pkg.scripts || {};
      
      // No scripts = static site (just HTML/CSS/JS, no build step)
      const hasNoScripts = Object.keys(scripts).length === 0;
      if (hasNoScripts) {
        return { template: "static", useNodebox: false };
      }
      
      // Server-side frameworks NEED Nodebox (slow but necessary)
      const needsNodebox = !!(
        deps.next ||           // Next.js (SSR)
        deps.nuxt ||           // Nuxt (SSR)
        deps["@remix-run/dev"] || // Remix (SSR)
        deps.astro ||          // Astro (SSR)
        deps.express ||        // Express server
        deps.fastify ||        // Fastify server
        deps.koa ||            // Koa server
        deps.hapi              // Hapi server
      );
      
      if (needsNodebox) {
        return { template: "node", useNodebox: true };
      }
      
      // Vite projects: use index.html as entry point, NOT the React template
      // Vite's index.html has <script type="module" src="/src/main.tsx"> which
      // Sandpack's bundler will follow. Using the React template would override
      // this with its own index.html and break the app.
      const isVite = isViteProject(pkg);
      if (isVite && hasIndexHtml) {
        return {
          template: "vanilla", // No template - use project's index.html
          useNodebox: false,
          entryPoint: "/index.html",
          isVite: true,
        };
      }
      
      // Non-Vite React projects (CRA, etc.) - use standard React template
      if (deps.react || deps["react-dom"]) {
        const entryPoint = findReactEntryPoint(files);
        return { 
          template: hasTsConfig ? "react-ts" : "react", 
          useNodebox: false,
          entryPoint,
        };
      }
      
      // Vanilla JS/TS projects
      if (hasTsConfig) {
        return { template: "vanilla-ts", useNodebox: false };
      }
    } catch {
      // Ignore parse errors
    }
  }
  
  if (hasIndexHtml) return { template: "static", useNodebox: false };
  return { template: "vanilla", useNodebox: false };
}

function SandpackContent({
  view,
  setView,
  onRetry,
}: {
  view: "preview" | "code" | "split" | "console";
  setView: (v: "preview" | "code" | "split" | "console") => void;
  onRetry: () => void;
}) {
  const { sandpack } = useSandpack();
  const isReady = sandpack.status === "running" || sandpack.status === "idle";
  const hasError = sandpack.status === "timeout";
  const isInitializing = sandpack.status === "initial";

  // Status message based on bundler state
  const getStatusMessage = () => {
    switch (sandpack.status) {
      case "initial": return "Initializing bundler...";
      case "idle": return "Ready";
      case "running": return "Running";
      case "timeout": return "Connection timed out";
      default: return `Status: ${sandpack.status}`;
    }
  };

  const tabClass = (active: boolean) =>
    `rounded px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? "bg-zinc-900 text-white"
        : "text-zinc-400 hover:text-zinc-200"
    }`;

  return (
    <div className="flex h-screen flex-col bg-zinc-950">
      {/* Toggle bar */}
      <div className="flex items-center gap-1 border-b border-zinc-800 px-3 py-1.5">
        <button onClick={() => setView("preview")} className={tabClass(view === "preview")}>
          Preview
        </button>
        <button onClick={() => setView("code")} className={tabClass(view === "code")}>
          Code
        </button>
        <button onClick={() => setView("split")} className={tabClass(view === "split")}>
          Split
        </button>
        <button onClick={() => setView("console")} className={tabClass(view === "console")}>
          Console
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {hasError ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-900/30">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6 text-red-500">
                <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-zinc-200">Bundler connection timed out</h3>
            <p className="max-w-sm text-center text-sm text-zinc-400">
              The Sandpack bundler took too long to respond.
            </p>
            <button onClick={onRetry} className="rounded bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
              Retry
            </button>
          </div>
        ) : view === "preview" ? (
          <SandpackPreviewPane showOpenInCodeSandbox={false} showRefreshButton style={{ height: "100%" }} />
        ) : view === "code" ? (
          <SandpackLayout style={{ height: "100%" }}>
            <SandpackFileExplorer style={{ height: "100%" }} />
            <SandpackCodeEditor style={{ height: "100%" }} showLineNumbers showTabs />
          </SandpackLayout>
        ) : view === "console" ? (
          <SandpackConsole style={{ height: "100%" }} showHeader />
        ) : (
          <SandpackLayout style={{ height: "100%" }}>
            <SandpackFileExplorer style={{ height: "100%", minWidth: 160 }} />
            <SandpackCodeEditor style={{ height: "100%", flex: 1 }} showLineNumbers showTabs />
            <SandpackPreviewPane showOpenInCodeSandbox={false} showRefreshButton style={{ height: "100%", flex: 1 }} />
          </SandpackLayout>
        )}
      </div>

      {/* Status bar */}
      <div className="border-t border-zinc-800 px-4 py-2">
        <p className={`text-xs ${hasError ? "text-red-400" : isReady ? "text-emerald-400" : "text-yellow-400"}`}>
          {getStatusMessage()}
          {isInitializing && (
            <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
          )}
        </p>
      </div>
    </div>
  );
}

function SandpackFrameContent() {
  const params = useParams<{ repoId: string }>();
  const searchParams = useSearchParams();
  const repoId = params.repoId as Id<"repos">;
  const sessionId = searchParams.get("session") as Id<"sessions"> | null;
  const branch = searchParams.get("branch") ?? undefined;

  const [view, setView] = useState<"preview" | "code" | "split" | "console">("preview");
  const [sandpackFiles, setSandpackFiles] = useState<SandpackFiles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const fetchRepoFiles = useAction(api.github.fetchRepoForWebContainer);
  const fileChanges = useQuery(
    api.fileChanges.getFileChanges,
    sessionId ? { sessionId } : "skip",
  );

  useEffect(() => {
    let cancelled = false;

    async function fetchFiles() {
      setLoading(true);
      setError(null);

      try {
        const fsTree = await fetchRepoFiles({ repoId, branch });
        if (cancelled) return;

        let files = flattenFileSystemTree(fsTree as Record<string, unknown>);
        files = filterFilesForSandpack(files);

        if (fileChanges?.files) {
          for (const change of fileChanges.files) {
            const path = change.path.startsWith("/") ? change.path : `/${change.path}`;
            files[path] = { code: change.content };
          }
        }

        setSandpackFiles(files);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load files");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchFiles();
    return () => { cancelled = true; };
  }, [repoId, branch, fileChanges, fetchRepoFiles, retryKey]);

  const handleRetry = () => setRetryKey(k => k + 1);

  if (loading || !sandpackFiles) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-zinc-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
        <p className="text-sm text-zinc-400">Loading files...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-zinc-950 p-6">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-900/30">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6 text-red-500">
            <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-zinc-200">Failed to load files</h3>
        <p className="max-w-sm text-center text-sm text-zinc-400">{error}</p>
        <button onClick={handleRetry} className="rounded bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
          Retry
        </button>
      </div>
    );
  }

  const { template, useNodebox, entryPoint, isVite } = detectTemplate(sandpackFiles);
  const isStatic = template === "static";
  const staticEntry = isStatic ? findStaticEntryPoint(sandpackFiles) : undefined;

  // If we found a custom entry point (e.g., Vite's main.tsx), mark it as active
  const filesWithEntry = entryPoint && sandpackFiles[entryPoint]
    ? {
        ...sandpackFiles,
        [entryPoint]: { ...sandpackFiles[entryPoint], active: true },
      }
    : sandpackFiles;

  // For static sites and Vite projects, don't use a template - templates include
  // default files that would override our actual project files (like index.html)
  const useTemplate = (isStatic || isVite) ? undefined : template;

  // For Vite projects, we need customSetup to tell Sandpack how to handle the
  // project. The entry is index.html, and we need to declare dependencies.
  const viteCustomSetup = isVite ? {
    customSetup: {
      entry: "/index.html",
      // Tell Sandpack about the dependencies from package.json
      // This ensures proper module resolution
      dependencies: (() => {
        try {
          const pkg = JSON.parse(sandpackFiles["/package.json"]?.code || "{}");
          return pkg.dependencies || {};
        } catch {
          return {};
        }
      })(),
    },
  } : {};

  return (
    <SandpackProvider
      key={retryKey}
      files={filesWithEntry}
      template={useTemplate}
      theme="dark"
      // For static sites without a template, we need customSetup to tell Sandpack
      // how to serve the files (entry point can be in /public or /src)
      {...(isStatic && staticEntry && {
        customSetup: {
          entry: staticEntry,
        },
      })}
      // For Vite projects, use customSetup with dependencies
      {...viteCustomSetup}
      options={{
        recompileMode: "delayed",
        recompileDelay: 500,
        bundlerTimeOut: 120000, // 2 minutes for Nodebox
        autorun: true,
        autoReload: true,
        // Specify entry point for non-standard project structures (e.g., Vite)
        ...(entryPoint && { activeFile: entryPoint }),
        // Enable service worker for static sites (needed for /public folder assets)
        ...(isStatic && { 
          experimental_enableServiceWorker: true,
        }),
        // Use Nodebox for server-side frameworks
        ...(useNodebox && {
          bundlerURL: "https://sandpack-bundler.codesandbox.io",
          experimental: {
            nodebox: true,
          },
        }),
      }}
    >
      <SandpackContent view={view} setView={setView} onRetry={handleRetry} />
    </SandpackProvider>
  );
}

// Need to wrap with ConvexAuthProvider since this page is loaded in an iframe
// and doesn't inherit the provider from the parent. Auth cookies are shared
// between same-origin iframes, so authentication will work.
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export default function SandpackFramePage() {
  return (
    <ConvexAuthProvider client={convex}>
      <SandpackFrameContent />
    </ConvexAuthProvider>
  );
}
