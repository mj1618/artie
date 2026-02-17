import express from "express";
import { spawn } from "child_process";
import { readFile, writeFile, mkdir, readdir, stat } from "fs/promises";
import { dirname, join, relative } from "path";
import { glob } from "glob";

const app = express();
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.API_PORT || 3001;
const API_SECRET = process.env.API_SECRET;
const PROJECT_DIR = process.env.PROJECT_DIR || "/app/project";

// Patterns to ignore when reading file tree
const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/*.log",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
];

// Auth middleware
function authenticate(req, res, next) {
  if (!API_SECRET) {
    return next(); // No secret configured, allow all
  }
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${API_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.use(authenticate);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    projectDir: PROJECT_DIR,
    uptime: process.uptime(),
  });
});

// Get clone status
app.get("/clone-status", async (req, res) => {
  try {
    // Check if project directory exists and has files
    const files = await readdir(PROJECT_DIR).catch(() => []);
    const hasPackageJson = files.includes("package.json");
    
    res.json({
      status: hasPackageJson ? "ready" : "pending",
      files: files.length,
      hasPackageJson,
    });
  } catch (error) {
    res.json({ status: "pending", error: error.message });
  }
});

// Read a single file
app.get("/files/read", async (req, res) => {
  try {
    const { path: filePath } = req.query;
    if (!filePath) {
      return res.status(400).json({ error: "path query parameter required" });
    }

    const fullPath = join(PROJECT_DIR, filePath);
    
    // Security: ensure path is within project dir
    if (!fullPath.startsWith(PROJECT_DIR)) {
      return res.status(403).json({ error: "Path outside project directory" });
    }

    const content = await readFile(fullPath, "utf-8");
    res.json({ path: filePath, content });
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({ error: "File not found" });
    }
    res.status(500).json({ error: error.message });
  }
});

// Read multiple files
app.post("/files/read-batch", async (req, res) => {
  try {
    const { paths } = req.body;
    if (!Array.isArray(paths)) {
      return res.status(400).json({ error: "paths array required" });
    }

    const results = await Promise.all(
      paths.map(async (filePath) => {
        const fullPath = join(PROJECT_DIR, filePath);
        if (!fullPath.startsWith(PROJECT_DIR)) {
          return { path: filePath, error: "Path outside project directory" };
        }
        try {
          const content = await readFile(fullPath, "utf-8");
          return { path: filePath, content };
        } catch (error) {
          return { path: filePath, error: error.message };
        }
      })
    );

    res.json({ files: results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Write files
app.post("/files/write", async (req, res) => {
  try {
    const { files } = req.body;
    if (!Array.isArray(files)) {
      return res.status(400).json({ error: "files array required" });
    }

    const results = await Promise.all(
      files.map(async ({ path: filePath, content }) => {
        const fullPath = join(PROJECT_DIR, filePath);
        
        // Security: ensure path is within project dir
        if (!fullPath.startsWith(PROJECT_DIR)) {
          return { path: filePath, error: "Path outside project directory" };
        }

        try {
          // Create parent directories if needed
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, content, "utf-8");
          return { path: filePath, success: true };
        } catch (error) {
          return { path: filePath, error: error.message };
        }
      })
    );

    const errors = results.filter((r) => r.error);
    if (errors.length > 0) {
      return res.status(207).json({ results, errors });
    }

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get file tree
app.get("/files/tree", async (req, res) => {
  try {
    const { maxSize = 100000 } = req.query; // Default 100KB max file size

    const files = await glob("**/*", {
      cwd: PROJECT_DIR,
      nodir: true,
      ignore: IGNORE_PATTERNS,
    });

    // Get file info and filter by size
    const fileList = await Promise.all(
      files.map(async (filePath) => {
        try {
          const fullPath = join(PROJECT_DIR, filePath);
          const stats = await stat(fullPath);
          return {
            path: filePath,
            size: stats.size,
            isText: stats.size <= Number(maxSize),
          };
        } catch {
          return null;
        }
      })
    );

    res.json({
      files: fileList.filter(Boolean),
      projectDir: PROJECT_DIR,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Execute bash command
app.post("/exec", async (req, res) => {
  try {
    const { command, timeout = 60000 } = req.body;
    if (!command) {
      return res.status(400).json({ error: "command required" });
    }

    const result = await executeCommand(command, {
      cwd: PROJECT_DIR,
      timeout: Number(timeout),
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper to execute commands
function executeCommand(command, options = {}) {
  return new Promise((resolve) => {
    const { cwd = PROJECT_DIR, timeout = 60000 } = options;
    
    let output = "";
    let timedOut = false;

    const proc = spawn("bash", ["-c", command], {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeout);

    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.stderr.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 0),
        output: output.slice(0, 100000), // Limit output size
        timedOut,
      });
    });

    proc.on("error", (error) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: 1,
        output: error.message,
        error: true,
      });
    });
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Sprite API server listening on port ${PORT}`);
  console.log(`Project directory: ${PROJECT_DIR}`);
});
