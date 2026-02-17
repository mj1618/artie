import { WebContainer } from "@webcontainer/api";

export interface CommandResult {
  exitCode: number;
  output: string;
}

/**
 * Run a bash command in the WebContainer.
 * 
 * @param container - The WebContainer instance
 * @param command - The full command string (e.g., "npm install lodash")
 * @param onOutput - Optional callback for streaming output
 * @returns Promise with exit code and combined output
 */
export async function runCommand(
  container: WebContainer,
  command: string,
  onOutput?: (data: string) => void,
): Promise<CommandResult> {
  // Parse the command into executable and args
  // Handle simple cases - for complex shell parsing, we'd need a proper parser
  const parts = parseCommand(command);
  const [cmd, ...args] = parts;

  if (!cmd) {
    return { exitCode: 1, output: "Error: Empty command" };
  }

  const outputChunks: string[] = [];

  try {
    const process = await container.spawn(cmd, args);

    // Pipe output to our collector and optional callback
    process.output.pipeTo(
      new WritableStream({
        write(data) {
          outputChunks.push(data);
          onOutput?.(data);
        },
      }),
    );

    const exitCode = await process.exit;
    const output = outputChunks.join("");

    return { exitCode, output };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      output: `Error executing command: ${errorMsg}`,
    };
  }
}

/**
 * Parse a command string into parts, handling basic quoting.
 * This is a simplified parser - for production, consider using shell-quote.
 */
function parseCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null;
      } else if (!inQuote) {
        inQuote = char;
      } else {
        current += char;
      }
      continue;
    }

    if (char === " " && !inQuote) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}
