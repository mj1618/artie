#!/bin/bash
# Deploy Docker Manager API to the Docker host
# Run this after deploy-docker-host.sh

set -e

# Configuration - set DOCKER_HOST_IP before running
DOCKER_HOST_IP="${DOCKER_HOST_IP:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -z "$DOCKER_HOST_IP" ]; then
    echo -e "${RED}Error: DOCKER_HOST_IP not set${NC}"
    echo "Usage: DOCKER_HOST_IP=1.2.3.4 ./deploy-docker-api.sh"
    exit 1
fi

echo -e "${GREEN}=== Docker Manager API Deployment ===${NC}"
echo "Target: root@$DOCKER_HOST_IP"

# Create the API server script
echo -e "${YELLOW}Creating API server...${NC}"
ssh -o StrictHostKeyChecking=no root@"$DOCKER_HOST_IP" 'cat > /opt/docker-manager/api/server.js' << 'APISERVER'
const express = require('express');
const Docker = require('dockerode');
const { spawn, exec } = require('child_process');
const { PassThrough } = require('stream');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

require('dotenv').config({ path: '/opt/docker-manager/.env' });

const app = express();
const docker = new Docker();
const PORT = 8081;
const API_SECRET = process.env.API_SECRET;
const REPO_CACHE_DIR = '/opt/docker-manager/repo-cache';
const PNPM_STORE_DIR = '/opt/docker-manager/pnpm-store';
const LOGS_DIR = '/opt/docker-manager/logs';

// Port allocation
let nextPort = 10000;
const usedPorts = new Set();

async function initPortAllocator() {
  try {
    const containers = await docker.listContainers({ all: true });
    for (const c of containers) {
      if (c.Ports) {
        for (const p of c.Ports) {
          if (p.PublicPort && p.PublicPort >= 10000 && p.PublicPort < 20000) {
            usedPorts.add(p.PublicPort);
          }
        }
      }
    }
    while (usedPorts.has(nextPort)) nextPort++;
    console.log(`Port allocator initialized: ${usedPorts.size} ports in use, next=${nextPort}`);
  } catch (err) {
    console.error('Failed to init port allocator:', err);
  }
}

function allocatePort() {
  while (usedPorts.has(nextPort) && nextPort < 20000) {
    nextPort++;
  }
  if (nextPort >= 20000) {
    nextPort = 10000;
    while (usedPorts.has(nextPort)) nextPort++;
  }
  const port = nextPort++;
  usedPorts.add(port);
  return port;
}

function releasePort(port) {
  usedPorts.delete(port);
}

// Middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '50mb' }));

// Auth middleware
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  const token = auth.slice(7);
  if (token !== API_SECRET) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  next();
}

// Health check (no auth required)
app.get('/health', async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    res.json({
      status: 'ok',
      containerCount: containers.length,
      uptime: process.uptime()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// List containers
app.get('/api/containers', authMiddleware, async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    res.json(containers.map(c => ({
      id: c.Id.slice(0, 12),
      name: c.Names[0]?.replace(/^\//, ''),
      image: c.Image,
      state: c.State,
      status: c.Status,
      ports: c.Ports
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get container details
app.get('/api/containers/:id', authMiddleware, async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    const info = await container.inspect();
    res.json({
      id: info.Id.slice(0, 12),
      name: info.Name.replace(/^\//, ''),
      image: info.Config.Image,
      state: info.State,
      created: info.Created
    });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'Container not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Create container
app.post('/api/containers', authMiddleware, async (req, res) => {
  try {
    const { name, image = 'node:24-slim', ports = [3000], volumeName, pool = false } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const hostPort = allocatePort();
    const portBindings = {};
    const exposedPorts = {};
    
    ports.forEach(port => {
      exposedPorts[`${port}/tcp`] = {};
      portBindings[`${port}/tcp`] = [{ HostPort: String(hostPort + ports.indexOf(port)) }];
    });

    const binds = [
      `${REPO_CACHE_DIR}:/opt/repo-cache:ro`,
      `${PNPM_STORE_DIR}:/pnpm-store`,
    ];
    if (volumeName) {
      binds.push(`${volumeName}:/app/node_modules`);
    }

    const container = await docker.createContainer({
      Image: image,
      name,
      Cmd: ['sleep', 'infinity'],
      Tty: true,
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        Binds: binds.length > 0 ? binds : undefined,
        Memory: 2048 * 1024 * 1024,
      },
      WorkingDir: '/app',
    });

    await container.start();

    const info = await container.inspect();

    res.status(201).json({
      id: info.Id.slice(0, 12),
      name: info.Name.replace(/^\//, ''),
      hostPort
    });
  } catch (err) {
    console.error('Create container error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Setup container (clone + install + start)
app.post('/api/containers/:id/setup', authMiddleware, async (req, res) => {
  const {
    repo,
    branch,
    defaultBranch,
    githubToken,
    callbackUrl,
    callbackSecret,
    hasMainImage,
    buildMainImage,
    envVars = {},
    restoredFromCheckpoint = false,
  } = req.body;

  const containerId = req.params.id;

  // Store callback secret for per-container auth (terminal WebSocket, logs SSE)
  if (callbackSecret) {
    storeCallbackSecret(containerId, callbackSecret);
  }

  // Return immediately
  res.json({ status: 'setup_started' });

  // Run setup in background
  runSetup(containerId, {
    repo,
    branch,
    defaultBranch: defaultBranch || 'main',
    githubToken,
    callbackUrl,
    callbackSecret,
    hasMainImage,
    buildMainImage,
    envVars,
    restoredFromCheckpoint,
  }).catch(err => {
    console.error(`Setup error for ${containerId}:`, err);
  });
});

async function sendCallback(url, secret, containerName, status, error = null, buildLog = null) {
  if (!url) return;
  
  try {
    const body = {
      containerName,
      callbackSecret: secret,
      status,
      error
    };
    if (buildLog) {
      body.buildLog = buildLog;
    }
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error('Callback error:', err.message);
  }
}

async function execInContainer(container, cmd, timeout = 300000) {
  const execInstance = await container.exec({
    Cmd: ['sh', '-c', cmd],
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: '/app'
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      clearInterval(pollId);
      fn(val);
    };

    const timeoutId = setTimeout(() => {
      settle(reject, new Error('Command timed out'));
    }, timeout);

    let pollId;

    execInstance.start({ hijack: true, stdin: false }, (err, stream) => {
      if (err) {
        return settle(reject, err);
      }

      let stdout = '';
      let stderr = '';

      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();
      stdoutStream.on('data', (chunk) => { stdout += chunk.toString(); });
      stderrStream.on('data', (chunk) => { stderr += chunk.toString(); });

      docker.modem.demuxStream(stream, stdoutStream, stderrStream);

      const finalize = async () => {
        try {
          const inspectData = await execInstance.inspect();
          settle(resolve, {
            exitCode: inspectData.ExitCode,
            stdout: stdout.trim(),
            stderr: stderr.trim()
          });
        } catch (e) {
          settle(resolve, { exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim() });
        }
      };

      stream.on('end', finalize);
      stream.on('error', (e) => settle(reject, e));

      pollId = setInterval(async () => {
        try {
          const inspectData = await execInstance.inspect();
          if (!inspectData.Running) {
            await new Promise(r => setTimeout(r, 100));
            await finalize();
          }
        } catch (_) {}
      }, 2000);
    });
  });
}

async function runSetup(containerId, opts) {
  const {
    repo,
    branch,
    defaultBranch,
    githubToken,
    callbackUrl,
    callbackSecret,
    hasMainImage,
    buildMainImage,
    envVars,
    restoredFromCheckpoint = false,
  } = opts;

  const container = docker.getContainer(containerId);
  let containerName;
  const buildLog = [];

  function logBuild(phase, output) {
    const timestamp = new Date().toISOString();
    buildLog.push(`[${timestamp}] === ${phase} ===`);
    const text = (output || '').trim();
    if (text) {
      for (const line of text.split('\n').slice(-80)) {
        buildLog.push(line);
      }
    }
    // Cap total lines to prevent unbounded growth
    while (buildLog.length > 500) buildLog.shift();
  }

  async function writeBuildLog(phase, output) {
    logBuild(phase, output);
    try {
      const escaped = buildLog.slice(-20).join('\n').replace(/'/g, "'\\''");
      await execInContainer(container, `echo '${escaped}' >> /tmp/composure-build.log`, 5000);
    } catch {}
  }

  try {
    const info = await container.inspect();
    containerName = info.Name.replace(/^\//, '');
  } catch (err) {
    console.error('Failed to get container info:', err);
    return;
  }

  try {
    // Initialize build log file inside container
    await execInContainer(container, 'echo "=== Composure Build Log ===" > /tmp/composure-build.log', 5000);

    const [owner, repoName] = repo.split('/');

    // Fast path: container created from checkpoint image — update code, quick install, start
    if (restoredFromCheckpoint) {
      await writeBuildLog('restore', 'Restored from checkpoint image, updating code');
      await sendCallback(callbackUrl, callbackSecret, containerName, 'cloning');

      if (Object.keys(envVars).length > 0) {
        const envContent = Object.entries(envVars)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n');
        const envB64 = Buffer.from(envContent).toString('base64');
        await execInContainer(container, `echo '${envB64}' | base64 -d > /app/.env`);
      }

      // Update bare cache from GitHub if token available, then pull into container
      const cacheDir = path.join(REPO_CACHE_DIR, owner);
      const bareRepoPath = path.join(cacheDir, `${repoName}.git`);
      const remotePath = `file:///opt/repo-cache/${owner}/${repoName}.git`;

      if (githubToken && fs.existsSync(bareRepoPath)) {
        const cloneUrl = `https://${githubToken}@github.com/${repo}.git`;
        try {
          await new Promise((resolve) => {
            exec(`cd "${bareRepoPath}" && git remote set-url origin "${cloneUrl}" && git fetch origin ${branch}`, { timeout: 60000 }, (err) => {
              if (err) console.warn(`Bare cache update failed: ${err.message}`);
              resolve();
            });
          });
        } catch (err) {
          console.warn(`Bare cache update error: ${err.message}`);
        }
      }

      await execInContainer(container,
        `cd /app && git remote set-url origin ${remotePath} 2>/dev/null; git fetch --depth 1 origin ${branch} 2>/dev/null && git reset --hard origin/${branch} 2>/dev/null`,
        30000
      );
      await writeBuildLog('git_update', 'Pulled latest changes');

      // Quick install in case deps changed (fast — node_modules volume is cached)
      await sendCallback(callbackUrl, callbackSecret, containerName, 'installing');
      await execInContainer(container, 'cd /app && pnpm install 2>&1 | tee -a /tmp/composure-build.log', 300000);
      await writeBuildLog('install', 'Dependencies updated');

      await sendCallback(callbackUrl, callbackSecret, containerName, 'starting');
      const restoreCheck = await execInContainer(container, `node -e "var s=require('./package.json').scripts||{};process.stdout.write(s.composure?'composure':'dev')"`, 5000);
      const restoreDevCmd = restoreCheck.stdout.trim() || 'dev';
      await execInContainer(container, `cd /app && nohup pnpm run ${restoreDevCmd} >> /tmp/composure-build.log 2>&1 &`, 10000);
      await writeBuildLog('dev_server', `Dev server started via pnpm run ${restoreDevCmd} (restored)`);

      let serverReady = false;
      for (let i = 0; i < 60; i++) {
        const check = await execInContainer(container,
          'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo 000', 2000);
        const code = check.stdout.trim();
        if (code !== '000' && code !== '0') {
          serverReady = true;
          break;
        }
        await new Promise(r => setTimeout(r, 500));
      }
      await writeBuildLog('health_check', serverReady ? 'Server responded' : 'Server did not respond within 30s, reporting ready anyway');
      await sendCallback(callbackUrl, callbackSecret, containerName, 'ready');
      return;
    }

    // Report cloning status
    await sendCallback(callbackUrl, callbackSecret, containerName, 'cloning');
    const cacheDir = path.join(REPO_CACHE_DIR, owner);
    const bareRepoPath = path.join(cacheDir, `${repoName}.git`);
    const lockFile = path.join(cacheDir, `${repoName}.git.lock`);

    // Ensure cache directory exists
    await fs.promises.mkdir(cacheDir, { recursive: true });

    async function waitForLock(maxWaitMs = 120000) {
      const start = Date.now();
      while (fs.existsSync(lockFile)) {
        if (Date.now() - start > maxWaitMs) {
          try { await fs.promises.unlink(lockFile); } catch {}
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    async function withLock(fn) {
      await waitForLock();
      await fs.promises.writeFile(lockFile, String(process.pid));
      try {
        return await fn();
      } finally {
        try { await fs.promises.unlink(lockFile); } catch {}
      }
    }

    if (!githubToken) {
      throw new Error('githubToken is required for non-checkpoint setup');
    }
    const cloneUrl = `https://${githubToken}@github.com/${repo}.git`;

    // Check for existing git repo inside container while updating bare cache
    // (runs in parallel — host git-fetch + container git-check overlap)
    const [, gitCheck] = await Promise.all([
      withLock(async () => {
        if (!fs.existsSync(bareRepoPath)) {
          await new Promise((resolve, reject) => {
            exec(`git clone --bare "${cloneUrl}" "${bareRepoPath}"`, { timeout: 120000 }, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } else {
          await new Promise((resolve, reject) => {
            exec(`cd "${bareRepoPath}" && git remote set-url origin "${cloneUrl}" && git fetch origin ${branch}`, { timeout: 60000 }, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      }),
      execInContainer(container, `test -d /app/.git && echo EXISTS || echo MISSING`, 5000),
    ]);

    const hasGitRepo = gitCheck.stdout.includes('EXISTS');
    const isNewBranch = branch !== defaultBranch;
    const remotePath = `file:///opt/repo-cache/${owner}/${repoName}.git`;

    let cloneResult;

    if (hasGitRepo) {
      // Prebuilt image already has repo — fetch + reset in a single exec call
      cloneResult = await execInContainer(container, [
        `git remote set-url origin ${remotePath} 2>/dev/null || git remote add origin ${remotePath}`,
        `git fetch --depth 1 origin ${branch}`,
        `git checkout -f ${branch}`,
        `git reset --hard origin/${branch}`,
      ].join(' && '), 60000);

      if (cloneResult.exitCode !== 0 && isNewBranch) {
        console.log(`Branch ${branch} not found on remote, falling back to ${defaultBranch} and creating new branch`);
        cloneResult = await execInContainer(container,
          `git fetch --depth 1 origin ${defaultBranch} && git checkout -f ${defaultBranch} && git reset --hard origin/${defaultBranch} && git checkout -b ${branch}`,
          60000
        );
      }
    } else {
      // Fresh container — init + shallow fetch + checkout in a single exec call
      cloneResult = await execInContainer(container,
        `git init && git remote add origin ${remotePath} && git fetch --depth 1 origin ${branch} && git checkout -B ${branch} FETCH_HEAD`,
        60000
      );

      if (cloneResult.exitCode !== 0 && isNewBranch) {
        console.log(`Branch ${branch} not found on remote, falling back to ${defaultBranch} and creating new branch`);
        cloneResult = await execInContainer(container,
          `git fetch --depth 1 origin ${defaultBranch} && git checkout -B ${defaultBranch} FETCH_HEAD && git checkout -b ${branch}`,
          60000
        );
      }
    }
    await writeBuildLog('clone', cloneResult.stdout);
    if (cloneResult.exitCode !== 0) {
      throw new Error(`Git setup failed (exit ${cloneResult.exitCode}): ${cloneResult.stderr || cloneResult.stdout}`);
    }

    // Report installing status
    await sendCallback(callbackUrl, callbackSecret, containerName, 'installing');

    // Install dependencies — pipe output to build log in real time
    const installResult = await execInContainer(container, 'cd /app && pnpm install 2>&1 | tee -a /tmp/composure-build.log', 600000);
    logBuild('install', installResult.stdout);
    if (installResult.exitCode !== 0) {
      throw new Error(`pnpm install failed (exit ${installResult.exitCode}): ${installResult.stderr || installResult.stdout}`);
    }

    // Build main image if requested
    if (buildMainImage) {
      try {
        const imageTag = `${owner}-${repoName}:main`;
        await container.commit({
          repo: imageTag,
          comment: `Main branch image for ${repo}`
        });
        console.log(`Built main image: ${imageTag}`);
        await writeBuildLog('image', `Built main image: ${imageTag}`);

        // Notify about image creation
        if (callbackUrl) {
          await fetch(callbackUrl.replace('docker-status', 'docker-image-status'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              containerName,
              callbackSecret,
              owner,
              repo: repoName,
              branch: 'main',
              imageTag,
              status: 'ready'
            })
          }).catch(err => console.error('Image callback error:', err));
        }
      } catch (err) {
        console.error('Failed to build main image:', err);
        await writeBuildLog('image_error', err.message);
      }
    }

    // Create checkpoint image after install (non-blocking, best-effort)
    if (callbackUrl) {
      const cpName = `cp-${owner}-${repoName}-${branch}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 60);
      const checkpointCallbackUrl = callbackUrl.replace('docker-status', 'docker-checkpoint-status');
      try {
        await fetch(`http://localhost:${PORT}/api/containers/${containerId}/checkpoint`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${API_SECRET}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            checkpointName: cpName,
            callbackUrl: checkpointCallbackUrl,
            callbackSecret: API_SECRET,
          }),
        });
        await writeBuildLog('checkpoint', `Checkpoint ${cpName} creation started`);
      } catch (err) {
        console.error('Checkpoint creation request failed:', err.message);
      }
    }

    // Report starting status
    await sendCallback(callbackUrl, callbackSecret, containerName, 'starting');

    // Create .env file if envVars provided
    if (Object.keys(envVars).length > 0) {
      const envContent = Object.entries(envVars)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
      const envB64 = Buffer.from(envContent).toString('base64');
      await execInContainer(container, `echo '${envB64}' | base64 -d > /app/.env`);
    }

    // Start dev server — prefer "composure" script if available, fall back to "dev"
    const scriptCheck = await execInContainer(container, `node -e "var s=require('./package.json').scripts||{};process.stdout.write(s.composure?'composure':'dev')"`, 5000);
    const devCmd = scriptCheck.stdout.trim() || 'dev';
    await execInContainer(container, `cd /app && nohup pnpm run ${devCmd} >> /tmp/composure-build.log 2>&1 &`, 10000);
    await writeBuildLog('dev_server', `Dev server started via pnpm run ${devCmd}`);

    // Poll for dev server readiness instead of fixed sleep
    let serverReady = false;
    for (let i = 0; i < 60; i++) {
      const check = await execInContainer(container,
        'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo 000', 2000);
      const code = check.stdout.trim();
      if (code !== '000' && code !== '0') {
        serverReady = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    await writeBuildLog('health_check', serverReady ? 'Server responded' : 'Server did not respond within 30s, reporting ready anyway');

    // Report ready
    await sendCallback(callbackUrl, callbackSecret, containerName, 'ready');

  } catch (err) {
    console.error(`Setup failed for ${containerName}:`, err);
    logBuild('FAILED', err.message);
    const logTail = buildLog.slice(-100).join('\n');
    await sendCallback(callbackUrl, callbackSecret, containerName, 'failed', err.message, logTail);
  }
}

// Execute command in container
app.post('/api/containers/:id/exec', authMiddleware, async (req, res) => {
  try {
    const { command, timeout = 60000 } = req.body;
    const container = docker.getContainer(req.params.id);

    const result = await execInContainer(container, command, timeout);
    res.json(result);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'Container not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Delete container
app.delete('/api/containers/:id', authMiddleware, async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    
    try {
      await container.stop({ t: 5 });
    } catch (e) {
      // Container might already be stopped
    }
    
    await container.remove({ force: true });
    removeCallbackSecret(req.params.id);
    res.json({ success: true });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'Container not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Logs endpoint (SSE) — tails /tmp/composure-build.log inside the container
// which contains build output (clone, install) and dev server output
app.get('/api/containers/:id/logs', async (req, res) => {
  const token = req.query.token;
  if (token !== API_SECRET && !validateCallbackSecret(req.params.id, token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const container = docker.getContainer(req.params.id);

  try {
    const logExec = await container.exec({
      Cmd: ['sh', '-c', 'test -f /tmp/composure-build.log && tail -n 200 -F /tmp/composure-build.log || (echo "Waiting for build log..." && sleep 2 && tail -n 200 -F /tmp/composure-build.log)'],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await logExec.start({ hijack: true, stdin: false });

    const logOut = new PassThrough();
    const logErr = new PassThrough();
    docker.modem.demuxStream(stream, logOut, logErr);

    const sendLines = (chunk) => {
      const raw = chunk.toString().trim();
      if (raw) {
        for (const line of raw.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) {
            res.write(`data: ${JSON.stringify({ line: trimmed, timestamp: Date.now() })}\n\n`);
          }
        }
      }
    };
    logOut.on('data', sendLines);
    logErr.on('data', sendLines);

    stream.on('end', () => res.end());
    stream.on('error', () => res.end());
    req.on('close', () => stream.destroy());
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message, timestamp: Date.now() })}\n\n`);
    res.end();
  }
});

// ====================
// CHECKPOINT / RESTORE (docker commit)
// ====================

// Commit a running container's filesystem as a reusable snapshot image.
// Unlike CRIU, this captures the filesystem (repo, build artifacts, config)
// but not running processes. The node_modules volume is separate and reused
// via the same named volume on restore.
app.post('/api/containers/:id/checkpoint', authMiddleware, async (req, res) => {
  const { checkpointName, callbackUrl, callbackSecret } = req.body;
  const containerId = req.params.id;

  if (!checkpointName) {
    return res.status(400).json({ error: 'checkpointName is required' });
  }

  res.json({ status: 'checkpoint_started', checkpointName });

  (async () => {
    try {
      const container = docker.getContainer(containerId);
      const imageTag = `${checkpointName}:latest`;

      await container.commit({
        repo: checkpointName,
        tag: 'latest',
        comment: `Checkpoint of container ${containerId}`,
      });

      console.log(`Checkpoint image created: ${imageTag} from container ${containerId}`);

      if (callbackUrl) {
        await fetch(callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callbackSecret,
            checkpointName,
            containerId,
            imageTag,
            status: 'ready',
          }),
        }).catch(err => console.error('Checkpoint callback error:', err));
      }
    } catch (err) {
      console.error(`Checkpoint failed for ${containerId}:`, err);
      if (callbackUrl) {
        await fetch(callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callbackSecret,
            checkpointName,
            containerId,
            status: 'failed',
            error: err.message,
          }),
        }).catch(cbErr => console.error('Checkpoint callback error:', cbErr));
      }
    }
  })();
});

// Create a new container from a checkpoint image
app.post('/api/checkpoints/:name/restore', authMiddleware, async (req, res) => {
  const { name: checkpointName } = req.params;
  const { containerName, ports = [3000], volumeName } = req.body;

  try {
    const imageTag = `${checkpointName}:latest`;

    try {
      await docker.getImage(imageTag).inspect();
    } catch (err) {
      if (err.statusCode === 404) {
        return res.status(404).json({ error: `Checkpoint image ${imageTag} not found` });
      }
      throw err;
    }

    const hostPort = allocatePort();
    const portBindings = {};
    const exposedPorts = {};
    ports.forEach(port => {
      exposedPorts[`${port}/tcp`] = {};
      portBindings[`${port}/tcp`] = [{ HostPort: String(hostPort + ports.indexOf(port)) }];
    });

    const binds = [
      `${REPO_CACHE_DIR}:/opt/repo-cache:ro`,
      `${PNPM_STORE_DIR}:/pnpm-store`,
    ];
    if (volumeName) {
      binds.push(`${volumeName}:/app/node_modules`);
    }

    const container = await docker.createContainer({
      Image: imageTag,
      name: containerName || `restore-${checkpointName}-${Date.now().toString(36)}`,
      Cmd: ['sleep', 'infinity'],
      Tty: true,
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        Binds: binds,
        Memory: 2048 * 1024 * 1024,
      },
      WorkingDir: '/app',
    });

    await container.start();

    const info = await container.inspect();
    const shortId = info.Id.slice(0, 12);

    console.log(`Restored container ${shortId} from checkpoint image ${imageTag}`);

    res.status(201).json({
      id: shortId,
      name: info.Name.replace(/^\//, ''),
      hostPort,
      restoredFrom: checkpointName,
    });
  } catch (err) {
    console.error('Restore from checkpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List available checkpoint images
app.get('/api/checkpoints', authMiddleware, async (req, res) => {
  try {
    const images = await docker.listImages();
    const checkpoints = images
      .filter(img => img.RepoTags && img.RepoTags.some(tag => tag.startsWith('cp-')))
      .map(img => ({
        name: img.RepoTags[0].split(':')[0],
        imageTag: img.RepoTags[0],
        size: img.Size,
        created: img.Created,
      }));
    res.json(checkpoints);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a checkpoint image
app.delete('/api/checkpoints/:name', authMiddleware, async (req, res) => {
  try {
    const imageTag = `${req.params.name}:latest`;
    await docker.getImage(imageTag).remove({ force: true });
    res.json({ success: true });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.json({ success: true });
    }
    res.status(500).json({ error: err.message });
  }
});

// Per-container callback secret validation
// Maps containerId -> callbackSecret so we can auth logs/terminal per-container
const containerSecrets = new Map();

function storeCallbackSecret(containerId, secret) {
  if (containerId && secret) {
    containerSecrets.set(containerId, secret);
  }
}

function removeCallbackSecret(containerId) {
  containerSecrets.delete(containerId);
}

function validateCallbackSecret(containerId, secret) {
  if (!secret) return false;
  return containerSecrets.get(containerId) === secret;
}

// Create HTTP server and WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const token = url.searchParams.get('token');
  const match = url.pathname.match(/^\/api\/containers\/([^/]+)\/terminal$/);
  const containerId = match ? match[1] : null;

  // Accept either the global API secret or a per-container callback secret
  const isGlobalAuth = token === API_SECRET;
  const isContainerAuth = containerId && validateCallbackSecret(containerId, token);

  if (!isGlobalAuth && !isContainerAuth) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', async (ws, request) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const match = url.pathname.match(/^\/api\/containers\/([^/]+)\/terminal$/);
  
  if (!match) {
    ws.close(1000, 'Invalid path');
    return;
  }

  const containerId = match[1];
  const container = docker.getContainer(containerId);

  try {
    const exec = await container.exec({
      Cmd: ['/bin/bash'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      WorkingDir: '/app'
    });

    const stream = await exec.start({ hijack: true, stdin: true });

    stream.on('data', (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data.toString());
      }
    });

    ws.on('message', (msg) => {
      stream.write(msg);
    });

    ws.on('close', () => {
      stream.end();
    });

    stream.on('end', () => {
      ws.close();
    });

  } catch (err) {
    ws.close(1011, err.message);
  }
});

initPortAllocator().then(() => {
  server.listen(PORT, () => {
    console.log(`Docker Manager API listening on port ${PORT}`);
  });
});
APISERVER

# Create package.json
ssh root@"$DOCKER_HOST_IP" 'cat > /opt/docker-manager/api/package.json' << 'PACKAGE'
{
  "name": "docker-manager-api",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "dockerode": "^4.0.0",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "ws": "^8.14.2"
  }
}
PACKAGE

# Install dependencies and create systemd service
echo -e "${YELLOW}Installing dependencies and creating service...${NC}"
ssh root@"$DOCKER_HOST_IP" << 'REMOTE'
mkdir -p /opt/docker-manager/pnpm-store
cd /opt/docker-manager/api
npm install

# Create systemd service
cat > /etc/systemd/system/docker-manager.service << 'SERVICE'
[Unit]
Description=Docker Manager API
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/docker-manager/api
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

# Enable and start service
systemctl daemon-reload
systemctl enable docker-manager
systemctl restart docker-manager

# Wait for service to start
sleep 3

# Check service status
systemctl status docker-manager --no-pager

# Test API
curl -s http://localhost:8081/health | jq .

echo "=== Docker Manager API deployed ==="

REMOTE

# Get API secret for reference
echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo "API URL: http://$DOCKER_HOST_IP:8081"
echo ""
echo "API Secret (add to Convex environment as DOCKER_API_SECRET):"
ssh root@"$DOCKER_HOST_IP" 'cat /opt/docker-manager/.env | cut -d= -f2'
echo ""
echo "Test the API:"
echo "  curl http://$DOCKER_HOST_IP:8081/health"
echo ""
echo "Add to Convex environment variables:"
echo "  DOCKER_HOST=$DOCKER_HOST_IP"
echo "  DOCKER_HOST_URL=http://$DOCKER_HOST_IP:8081"
echo "  DOCKER_API_SECRET=<secret_above>"
