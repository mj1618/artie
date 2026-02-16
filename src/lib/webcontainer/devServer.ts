import { WebContainer } from "@webcontainer/api";
import { detectProjectType, type ProjectType } from "./detect";

export type DevServerStatus =
  | "idle"
  | "installing"
  | "starting"
  | "running"
  | "error";

export interface DevServerState {
  status: DevServerStatus;
  url: string | null;
  error: string | null;
  output: string[];
}

function getDevCommand(projectType: ProjectType): { cmd: string; args: string[] } {
  switch (projectType) {
    case "nextjs":
      // Use --webpack because Turbopack's turbo.createProject isn't supported by WASM bindings
      return { cmd: "npx", args: ["next", "dev", "--port", "3000", "--webpack"] };
    case "vite":
      return { cmd: "npx", args: ["vite", "--port", "3000", "--host"] };
    case "cra":
      return { cmd: "npx", args: ["react-scripts", "start"] };
    default:
      return { cmd: "npm", args: ["run", "dev"] };
  }
}

/**
 * Patch Vite config for WebContainer compatibility.
 * esbuild's native binaries don't work in WebContainer, so we need to disable
 * dependency pre-bundling which relies on esbuild.
 */
async function patchViteConfigForWebContainer(container: WebContainer): Promise<void> {
  // Check for existing vite config files
  const configFiles = ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"];
  let existingConfig: string | null = null;
  let configPath: string | null = null;

  for (const file of configFiles) {
    try {
      existingConfig = await container.fs.readFile(file, "utf-8");
      configPath = file;
      break;
    } catch {
      // File doesn't exist, continue checking
    }
  }

  if (existingConfig && configPath) {
    // Check if already patched
    if (existingConfig.includes("optimizeDeps") && existingConfig.includes("disabled")) {
      return; // Already configured
    }

    // Patch existing config - add optimizeDeps.disabled to the defineConfig call
    // Look for defineConfig({ and inject our settings
    let patched = existingConfig;

    // Try to inject into existing defineConfig
    if (patched.includes("defineConfig({")) {
      patched = patched.replace(
        "defineConfig({",
        `defineConfig({\n  // WebContainer: disable esbuild dep optimization (native binaries don't work)\n  optimizeDeps: { disabled: true },`
      );
    } else if (patched.includes("defineConfig(")) {
      // Handle defineConfig(config) pattern - wrap the config
      patched = patched.replace(
        /defineConfig\((\{[\s\S]*?\})\)/,
        (_, config) => {
          // Add optimizeDeps if not present
          const trimmed = config.trim();
          const inner = trimmed.slice(1, -1).trim();
          return `defineConfig({\n  // WebContainer: disable esbuild dep optimization\n  optimizeDeps: { disabled: true },\n  ${inner}\n})`;
        }
      );
    } else {
      // Fallback: export default { ... } pattern
      patched = patched.replace(
        /export\s+default\s*\{/,
        `export default {\n  // WebContainer: disable esbuild dep optimization\n  optimizeDeps: { disabled: true },`
      );
    }

    if (patched !== existingConfig) {
      await container.fs.writeFile(configPath, patched);
    }
  } else {
    // No vite config exists - create a minimal one
    const webContainerViteConfig = `// Auto-generated Vite config for WebContainer compatibility
import { defineConfig } from 'vite'

export default defineConfig({
  // WebContainer: disable esbuild dep optimization (native binaries don't work)
  optimizeDeps: {
    disabled: true,
  },
})
`;
    await container.fs.writeFile("vite.config.js", webContainerViteConfig);
  }
}

export async function startDevServer(
  container: WebContainer,
  onStatus: (state: Partial<DevServerState>) => void,
): Promise<void> {
  const output: string[] = [];

  const projectType = await detectProjectType(container);

  // Patch Vite config for WebContainer compatibility before installing
  // (esbuild native binaries don't work in WebContainer's browser runtime)
  if (projectType === "vite") {
    try {
      await patchViteConfigForWebContainer(container);
      output.push("Patched Vite config for WebContainer compatibility");
    } catch (err) {
      output.push(`Warning: Could not patch Vite config: ${err}`);
    }
  }

  onStatus({ status: "installing", output: ["Installing dependencies with pnpm..."] });
  const installProcess = await container.spawn("pnpm", ["install"]);

  installProcess.output.pipeTo(
    new WritableStream({
      write(data) {
        output.push(data);
        onStatus({ output: [...output] });
      },
    }),
  );

  const installExitCode = await installProcess.exit;
  if (installExitCode !== 0) {
    onStatus({
      status: "error",
      error: `pnpm install failed with exit code ${installExitCode}`,
      output,
    });
    return;
  }

  onStatus({ status: "starting", output: [...output, "Starting dev server..."] });
  const { cmd, args } = getDevCommand(projectType);
  const serverProcess = await container.spawn(cmd, args);

  serverProcess.output.pipeTo(
    new WritableStream({
      write(data) {
        output.push(data);
        onStatus({ output: [...output] });
      },
    }),
  );

  container.on("server-ready", (_port: number, url: string) => {
    onStatus({ status: "running", url, output: [...output] });
  });
}
