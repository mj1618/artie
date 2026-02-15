import { WebContainer } from "@webcontainer/api";

export type ProjectType = "nextjs" | "vite" | "cra" | "static" | "unknown";

/**
 * Detect the project type by examining package.json and file structure.
 */
export async function detectProjectType(
  container: WebContainer,
): Promise<ProjectType> {
  try {
    const packageJsonStr = await container.fs.readFile("package.json", "utf-8");
    const packageJson = JSON.parse(packageJsonStr);
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    if (deps["next"]) return "nextjs";
    if (deps["vite"]) return "vite";
    if (deps["react-scripts"]) return "cra";

    return "unknown";
  } catch {
    // No package.json — check for index.html (static site)
    try {
      await container.fs.readFile("index.html", "utf-8");
      return "static";
    } catch {
      return "unknown";
    }
  }
}

/**
 * Detect if the project uses Convex.
 */
export async function detectConvex(
  container: WebContainer,
): Promise<boolean> {
  try {
    await container.fs.readdir("convex");
    return true;
  } catch {
    return false;
  }
}
