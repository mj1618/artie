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
      return { cmd: "npx", args: ["next", "dev", "--port", "3000"] };
    case "vite":
      return { cmd: "npx", args: ["vite", "--port", "3000", "--host"] };
    case "cra":
      return { cmd: "npx", args: ["react-scripts", "start"] };
    default:
      return { cmd: "npm", args: ["run", "dev"] };
  }
}

export async function startDevServer(
  container: WebContainer,
  onStatus: (state: Partial<DevServerState>) => void,
): Promise<void> {
  const output: string[] = [];

  const projectType = await detectProjectType(container);

  onStatus({ status: "installing", output: ["Installing dependencies..."] });
  const installProcess = await container.spawn("npm", ["install"]);

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
      error: `npm install failed with exit code ${installExitCode}`,
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
