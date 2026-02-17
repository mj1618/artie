# Epic: Firecracker VM Runtime for Project Previews

## Overview

Add a new "Firecracker" runtime option for projects that provides isolated, fast-booting microVMs for previewing Next.js applications. Unlike DigitalOcean Droplets (which create new cloud VMs per session), Firecracker VMs run on a dedicated host machine and boot in under 1 second.

## Existing Infrastructure

We already have a Firecracker host running with a management API. See `swarm/FIRECRACKER.md` for full details.

### Host Summary

| Property | Value |
|----------|-------|
| **Host IP** | `157.230.181.26` |
| **API Port** | `8080` |
| **API Secret** | `23c17c1952fa688c07da3f738e1058d83624cad71c91e1ccf4172049f80cb5f5` |
| **Specs** | 8 vCPUs, 16GB RAM, 320GB SSD |
| **Max VMs** | ~15 (at 1GB each) or ~30 (at 512MB each) |

### Existing API Endpoints

```bash
# Health check (no auth)
GET /health

# List VMs
GET /api/vms

# Get VM details  
GET /api/vms/<id>

# Create VM
POST /api/vms
# Body: { "name": "string", "memory": 512, "vcpus": 1, "ports": [3000] }
# Returns: { "id", "name", "status", "ip", "ports": [{ "guest": 3000, "host": 10000 }] }

# Destroy VM
DELETE /api/vms/<id>
```

### Port Mapping

- Guest port 3000 → Host port `10000 + (vm_index * 100)`
- Access via: `http://157.230.181.26:<host_port>`

---

## What Needs to Be Built

The host API creates bare VMs but doesn't handle:
1. **Cloning repos** into the VM
2. **Running `pnpm install && pnpm dev`**
3. **Streaming logs** from the VM
4. **Terminal access** to the VM
5. **Status callbacks** to Convex

We have two options:

### Option A: Extend Host API (Recommended)

Add new endpoints to the existing host API:

```bash
# Execute command in VM
POST /api/vms/<id>/exec
# Body: { "command": "pnpm install" }

# Stream logs from VM (SSE)
GET /api/vms/<id>/logs

# Terminal WebSocket
WS /api/vms/<id>/terminal

# Clone repo and setup
POST /api/vms/<id>/setup
# Body: { "repo": "owner/repo", "branch": "main", "githubToken": "...", "callbackUrl": "..." }
```

### Option B: Boot-time Configuration

Pass configuration to the VM at creation time, and have an init script inside the VM that:
1. Receives repo/token info via cloud-init or metadata service
2. Clones the repo
3. Runs pnpm install/dev
4. Reports status back to Convex via HTTP callback

**Decision**: Option A is cleaner and matches patterns from Droplets. Extend the host API.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Frontend (Browser)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │ Preview Tab  │  │  Logs Tab    │  │ Terminal Tab │                   │
│  │  (iframe)    │  │ (SSE stream) │  │ (WebSocket)  │                   │
│  └──────────────┘  └──────────────┘  └──────────────┘                   │
└─────────────────────────────────────────────────────────────────────────┘
         │                   │                   │
         │ :10000+           │ :8080/logs        │ :8080/terminal
         ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Firecracker Host (157.230.181.26)                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                 Host API (:8080) - EXISTING + EXTENSIONS           │ │
│  │  EXISTING:                      NEW:                               │ │
│  │  - GET /health                  - POST /api/vms/:id/setup          │ │
│  │  - GET /api/vms                 - POST /api/vms/:id/exec           │ │
│  │  - GET /api/vms/:id             - GET /api/vms/:id/logs (SSE)      │ │
│  │  - POST /api/vms                - WS /api/vms/:id/terminal         │ │
│  │  - DELETE /api/vms/:id                                             │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐                  │
│  │ Firecracker   │ │ Firecracker   │ │ Firecracker   │                  │
│  │    VM 1       │ │    VM 2       │ │    VM 3       │                  │
│  │  :10000       │ │  :10100       │ │  :10200       │                  │
│  └───────────────┘ └───────────────┘ └───────────────┘                  │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ HTTP callbacks (status updates)
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Convex Backend                                   │
│  - firecrackerVms table (state tracking)                                │
│  - firecrackerScheduler (lifecycle management)                          │
│  - HTTP endpoint for VM status callbacks                                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Extend Host API

**Goal**: Add setup, exec, logs, and terminal endpoints to the existing host API.

**Location**: SSH into host and edit `/opt/firecracker/api/server.js`

#### 1.1 Setup Endpoint

```javascript
// POST /api/vms/:id/setup
// Clones repo and sets up the project
app.post('/api/vms/:id/setup', authenticate, async (req, res) => {
  const { id } = req.params;
  const { repo, branch, githubToken, callbackUrl, callbackSecret } = req.body;
  
  const vm = vms.get(id);
  if (!vm) return res.status(404).json({ error: 'VM not found' });
  
  // Store callback info for status updates
  vm.callbackUrl = callbackUrl;
  vm.callbackSecret = callbackSecret;
  
  // Run setup in background
  runSetup(vm, { repo, branch, githubToken }).catch(console.error);
  
  res.json({ status: 'setup_started' });
});

async function runSetup(vm, { repo, branch, githubToken }) {
  try {
    await reportStatus(vm, 'cloning');
    await execInVm(vm, `git clone --depth 1 --branch ${branch} https://${githubToken}@github.com/${repo}.git /app`);
    
    await reportStatus(vm, 'installing');
    await execInVm(vm, 'cd /app && pnpm install');
    
    await reportStatus(vm, 'starting');
    // Start dev server in background, output to log file
    execInVm(vm, 'cd /app && pnpm dev > /var/log/devserver.log 2>&1 &');
    
    // Wait for port 3000 to be listening
    await waitForPort(vm, 3000, 120000);
    
    await reportStatus(vm, 'ready');
  } catch (err) {
    await reportStatus(vm, 'failed', err.message);
  }
}

async function reportStatus(vm, status, error) {
  if (!vm.callbackUrl) return;
  await fetch(vm.callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${vm.callbackSecret}`,
    },
    body: JSON.stringify({ vmId: vm.id, vmName: vm.name, status, error }),
  });
}
```

#### 1.2 Exec Endpoint

```javascript
// POST /api/vms/:id/exec
app.post('/api/vms/:id/exec', authenticate, async (req, res) => {
  const { id } = req.params;
  const { command, timeout = 60000 } = req.body;
  
  const vm = vms.get(id);
  if (!vm) return res.status(404).json({ error: 'VM not found' });
  
  try {
    const result = await execInVm(vm, command, { timeout });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function execInVm(vm, command, options = {}) {
  // Execute via SSH to VM's internal IP
  return new Promise((resolve, reject) => {
    const proc = spawn('ssh', [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      `root@${vm.ip}`,
      command
    ]);
    
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Command timed out'));
    }, options.timeout || 60000);
    
    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}
```

#### 1.3 Logs Endpoint (SSE)

```javascript
// GET /api/vms/:id/logs
app.get('/api/vms/:id/logs', authenticate, (req, res) => {
  const { id } = req.params;
  const vm = vms.get(id);
  if (!vm) return res.status(404).json({ error: 'VM not found' });
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Tail the log file inside the VM
  const tail = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    `root@${vm.ip}`,
    'tail -f /var/log/devserver.log 2>/dev/null || echo "Waiting for logs..."'
  ]);
  
  tail.stdout.on('data', data => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      res.write(`data: ${JSON.stringify({ line, timestamp: Date.now() })}\n\n`);
    }
  });
  
  tail.stderr.on('data', data => {
    res.write(`data: ${JSON.stringify({ line: data.toString(), timestamp: Date.now(), type: 'stderr' })}\n\n`);
  });
  
  req.on('close', () => tail.kill());
});
```

#### 1.4 Terminal WebSocket

```javascript
const WebSocket = require('ws');
const wss = new WebSocket.Server({ noServer: true });

// Upgrade HTTP to WebSocket for /api/vms/:id/terminal
server.on('upgrade', (request, socket, head) => {
  const match = request.url.match(/\/api\/vms\/([^\/]+)\/terminal/);
  if (!match) {
    socket.destroy();
    return;
  }
  
  // TODO: Verify auth token from query string
  const vmId = match[1];
  const vm = vms.get(vmId);
  if (!vm) {
    socket.destroy();
    return;
  }
  
  wss.handleUpgrade(request, socket, head, ws => {
    // SSH into the VM
    const shell = spawn('ssh', [
      '-tt',
      '-o', 'StrictHostKeyChecking=no',
      `root@${vm.ip}`,
      'bash'
    ]);
    
    shell.stdout.on('data', data => ws.send(data));
    shell.stderr.on('data', data => ws.send(data));
    ws.on('message', msg => shell.stdin.write(msg));
    ws.on('close', () => shell.kill());
    shell.on('close', () => ws.close());
  });
});
```

**Verification checkpoint**:
```bash
# Test creating a VM and running setup
curl -X POST http://157.230.181.26:8080/api/vms \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"name": "test-vm", "memory": 1024, "vcpus": 1}'

# Get the VM ID from response, then:
curl -X POST http://157.230.181.26:8080/api/vms/<id>/exec \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"command": "echo hello world"}'
```

---

### Phase 2: Convex Backend Integration

**Goal**: Manage Firecracker VM lifecycle through Convex with full state tracking.

#### 2.1 Schema Updates

**File: `convex/schema.ts`**

```typescript
// Add "firecracker" to runtime union in repos table (line ~54)
runtime: v.optional(v.union(
  v.literal("webcontainer"),
  v.literal("flyio-sprite"),
  v.literal("sandpack"),
  v.literal("digitalocean-droplet"),
  v.literal("firecracker")  // NEW
)),

// New table (add after dropletQuotas)
firecrackerVms: defineTable({
  // Identifiers
  sessionId: v.id("sessions"),
  repoId: v.id("repos"),
  teamId: v.id("teams"),
  userId: v.string(),

  // VM metadata (assigned by host API)
  vmId: v.optional(v.string()),       // e.g., "abc12345"
  vmName: v.string(),                 // e.g., "artie-myrepo-abc123"
  vmIp: v.optional(v.string()),       // Internal IP, e.g., "172.16.0.100"
  
  // Port mapping (from host API response)
  hostPort: v.optional(v.number()),   // e.g., 10000
  
  // Constructed URLs
  previewUrl: v.optional(v.string()), // http://157.230.181.26:10000
  logsUrl: v.optional(v.string()),    // http://157.230.181.26:8080/api/vms/{id}/logs
  terminalUrl: v.optional(v.string()),// ws://157.230.181.26:8080/api/vms/{id}/terminal

  // State machine
  status: v.union(
    v.literal("requested"),    // DB record created
    v.literal("creating"),     // Host API call in progress
    v.literal("booting"),      // VM created, waiting for SSH
    v.literal("cloning"),      // Cloning repository
    v.literal("installing"),   // pnpm install
    v.literal("starting"),     // pnpm dev starting
    v.literal("ready"),        // Dev server listening
    v.literal("active"),       // Ready + recent heartbeat
    v.literal("stopping"),     // Stop requested
    v.literal("destroying"),   // Host API delete in progress
    v.literal("destroyed"),    // Fully cleaned up
    v.literal("unhealthy")     // Failed or timed out
  ),

  // Authentication
  apiSecret: v.string(),       // For status callbacks

  // Error handling
  errorMessage: v.optional(v.string()),
  retryCount: v.number(),
  lastRetryAt: v.optional(v.number()),

  // Timestamps
  createdAt: v.number(),
  statusChangedAt: v.number(),
  lastHeartbeatAt: v.optional(v.number()),
  destroyedAt: v.optional(v.number()),

  // Audit trail
  statusHistory: v.array(v.object({
    status: v.string(),
    timestamp: v.number(),
    reason: v.optional(v.string()),
  })),

  // Repository context
  branch: v.optional(v.string()),
})
  .index("by_sessionId", ["sessionId"])
  .index("by_repoId", ["repoId"])
  .index("by_repoId_branch", ["repoId", "branch"])
  .index("by_teamId", ["teamId"])
  .index("by_vmId", ["vmId"])
  .index("by_vmName", ["vmName"])
  .index("by_status", ["status"]),
```

#### 2.2 Backend Module

**File: `convex/firecrackerVms.ts`**

Follow the pattern from `convex/droplets.ts`. Key differences:
- API calls go to `http://157.230.181.26:8080` instead of DigitalOcean
- After creating VM, call `/api/vms/:id/setup` to clone and start
- Faster timeouts (VMs boot in <1s, not 60s)

```typescript
// Constants
const FIRECRACKER_HOST = "http://157.230.181.26:8080";

// Timeouts (much faster than Droplets)
export const TIMEOUTS = {
  creating: 30 * 1000,      // 30 seconds (VM creation)
  booting: 30 * 1000,       // 30 seconds (SSH available)
  cloning: 5 * 60 * 1000,   // 5 minutes
  installing: 15 * 60 * 1000, // 15 minutes
  starting: 2 * 60 * 1000,  // 2 minutes
  heartbeat_warning: 60 * 1000,
  heartbeat_stop: 5 * 60 * 1000,
};

// Action: Create VM on Firecracker host
export const createVm = internalAction({
  args: { vmId: v.id("firecrackerVms") },
  handler: async (ctx, args) => {
    const vm = await ctx.runQuery(internal.firecrackerVms.getByIdInternal, { vmId: args.vmId });
    if (!vm) return;

    const apiSecret = process.env.FIRECRACKER_API_SECRET;
    
    // Create VM via host API
    const response = await fetch(`${FIRECRACKER_HOST}/api/vms`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: vm.vmName,
        memory: 1024,
        vcpus: 1,
        ports: [3000],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: args.vmId,
        status: 'unhealthy',
        updates: { errorMessage: `Failed to create VM: ${error}` },
        reason: 'create_failed',
      });
      return;
    }

    const data = await response.json();
    // data: { id, name, status, ip, ports: [{ guest: 3000, host: 10000 }] }

    const hostPort = data.ports?.[0]?.host;
    
    await ctx.runMutation(internal.firecrackerVms.updateStatus, {
      vmId: args.vmId,
      status: 'booting',
      updates: {
        vmId: data.id,
        vmIp: data.ip,
        hostPort,
        previewUrl: `http://157.230.181.26:${hostPort}`,
        logsUrl: `http://157.230.181.26:8080/api/vms/${data.id}/logs`,
        terminalUrl: `ws://157.230.181.26:8080/api/vms/${data.id}/terminal`,
      },
      reason: 'vm_created',
    });

    // Schedule setup
    await ctx.scheduler.runAfter(2000, internal.firecrackerVms.setupVm, { vmId: args.vmId });
  },
});

// Action: Call setup endpoint on host
export const setupVm = internalAction({
  args: { vmId: v.id("firecrackerVms") },
  handler: async (ctx, args) => {
    const vm = await ctx.runQuery(internal.firecrackerVms.getByIdInternal, { vmId: args.vmId });
    if (!vm || !vm.vmId) return;

    // Get repo and user's GitHub token
    const repo = await ctx.runQuery(api.projects.get, { repoId: vm.repoId });
    if (!repo) return;

    const githubToken = await getUserGithubTokenById(ctx, vm.userId);
    if (!githubToken) {
      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: args.vmId,
        status: 'unhealthy',
        updates: { errorMessage: 'GitHub token not available' },
        reason: 'no_github_token',
      });
      return;
    }

    const apiSecret = process.env.FIRECRACKER_API_SECRET;
    const callbackUrl = process.env.CONVEX_SITE_URL + '/firecracker-status';

    // Call setup endpoint
    const response = await fetch(`${FIRECRACKER_HOST}/api/vms/${vm.vmId}/setup`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repo: `${repo.githubOwner}/${repo.githubRepo}`,
        branch: vm.branch || repo.defaultBranch,
        githubToken,
        callbackUrl,
        callbackSecret: vm.apiSecret,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: args.vmId,
        status: 'unhealthy',
        updates: { errorMessage: `Setup failed: ${error}` },
        reason: 'setup_failed',
      });
    }
    // Status updates will come via HTTP callback from host
  },
});
```

#### 2.3 HTTP Endpoint for Status Callbacks

**File: `convex/http.ts`**

```typescript
// Add after droplet-status handler
http.route({
  path: "/firecracker-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { vmName, callbackSecret, status, error } = body;

      const result = await ctx.runMutation(
        internal.firecrackerVms.updateStatusFromHost,
        { vmName, apiSecret: callbackSecret, status, errorMessage: error }
      );

      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});
```

#### 2.4 Scheduler

**File: `convex/firecrackerScheduler.ts`**

Similar to `dropletScheduler.ts` but with faster intervals.

**File: `convex/crons.ts`**

```typescript
// Firecracker scheduler (faster than droplets)
crons.interval("firecracker:processRequested", { seconds: 5 }, internal.firecrackerScheduler.processRequested);
crons.interval("firecracker:checkHeartbeats", { seconds: 30 }, internal.firecrackerScheduler.checkHeartbeats);
crons.interval("firecracker:checkTimeouts", { seconds: 15 }, internal.firecrackerScheduler.checkTimeouts);
crons.interval("firecracker:processStopping", { seconds: 10 }, internal.firecrackerScheduler.processStopping);
```

---

### Phase 3: Frontend Preview Component

**Goal**: Build the preview UI with Preview, Logs, and Terminal tabs.

#### 3.1 FirecrackerPreview Component

**File: `src/components/preview/FirecrackerPreview.tsx`**

Follow the pattern from `DropletPreview.tsx` with three tabs.

```tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { FirecrackerTerminal } from "./FirecrackerTerminal";

interface FirecrackerPreviewProps {
  repoId: Id<"repos">;
  sessionId: Id<"sessions"> | null;
  branch?: string;
}

type ViewMode = "preview" | "logs" | "terminal";

export function FirecrackerPreview({ repoId, sessionId, branch }: FirecrackerPreviewProps) {
  const [view, setView] = useState<ViewMode>("preview");
  // ... similar structure to DropletPreview
}
```

#### 3.2 SSE Logs Component

**File: `src/components/preview/FirecrackerLogs.tsx`**

```tsx
"use client";

import { useState, useEffect, useRef } from "react";

interface FirecrackerLogsProps {
  logsUrl: string;
  apiSecret: string;
}

export function FirecrackerLogs({ logsUrl, apiSecret }: FirecrackerLogsProps) {
  const [logs, setLogs] = useState<Array<{ line: string; timestamp: number }>>([]);
  const [connected, setConnected] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    // EventSource doesn't support custom headers, so pass token in query string
    const url = `${logsUrl}?token=${encodeURIComponent(apiSecret)}`;
    const eventSource = new EventSource(url);

    eventSource.onopen = () => setConnected(true);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLogs(prev => [...prev.slice(-500), data]); // Keep last 500 lines
    };

    eventSource.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects
    };

    return () => eventSource.close();
  }, [logsUrl, apiSecret]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  return (
    <div className="flex flex-col h-full bg-paper-100">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-paper-300">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
          <span className="text-xs text-paper-500">
            {connected ? 'Connected' : 'Connecting...'}
          </span>
        </div>
        <label className="flex items-center gap-1 text-xs text-paper-500">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={e => setAutoScroll(e.target.checked)}
            className="w-3 h-3"
          />
          Auto-scroll
        </label>
      </div>
      
      {/* Log content */}
      <div className="flex-1 overflow-auto p-3 font-mono text-xs">
        {logs.map((entry, i) => (
          <LogLine key={i} line={entry.line} timestamp={entry.timestamp} />
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}

function LogLine({ line, timestamp }: { line: string; timestamp: number }) {
  const time = new Date(timestamp).toLocaleTimeString();
  const isError = line.toLowerCase().includes('error');
  const isWarning = line.toLowerCase().includes('warn');
  const isSuccess = line.includes('ready') || line.includes('listening');
  const isPhase = line.startsWith('===');

  return (
    <div className={`
      ${isError ? 'text-red-500' : ''}
      ${isWarning ? 'text-yellow-600' : ''}
      ${isSuccess ? 'text-green-600' : ''}
      ${isPhase ? 'font-bold text-blue-400 mt-2' : ''}
      ${!isError && !isWarning && !isSuccess && !isPhase ? 'text-paper-600' : ''}
    `}>
      <span className="text-paper-400 select-none mr-2">{time}</span>
      {line}
    </div>
  );
}
```

#### 3.3 Terminal Component

**File: `src/components/preview/FirecrackerTerminal.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface FirecrackerTerminalProps {
  terminalUrl: string;
  apiSecret: string;
}

export function FirecrackerTerminal({ terminalUrl, apiSecret }: FirecrackerTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#e0e0e0',
        cursor: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    // Connect WebSocket with auth token in query string
    const url = `${terminalUrl}?token=${encodeURIComponent(apiSecret)}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setStatus('connected');
      term.write('\r\n\x1b[32mConnected to Firecracker VM\x1b[0m\r\n\r\n');
    };

    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        term.write(e.data);
      } else if (e.data instanceof Blob) {
        e.data.text().then(text => term.write(text));
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = () => setStatus('disconnected');

    term.onData(data => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
  }, [terminalUrl, apiSecret]);

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-paper-700">
        <div className={`w-2 h-2 rounded-full ${
          status === 'connected' ? 'bg-green-500' :
          status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
          'bg-red-500'
        }`} />
        <span className="text-xs text-paper-400">
          {status === 'connected' ? 'Connected' :
           status === 'connecting' ? 'Connecting...' :
           status === 'error' ? 'Connection error' :
           'Disconnected'}
        </span>
      </div>
      <div ref={terminalRef} className="flex-1" />
    </div>
  );
}
```

#### 3.4 Add to PreviewPanel

**File: `src/components/preview/PreviewPanel.tsx`**

```tsx
import { FirecrackerPreview } from "./FirecrackerPreview";

// In the component, add:
if (runtime === "firecracker") {
  return (
    <FirecrackerPreview
      repoId={repoId}
      sessionId={sessionId}
      branch={branch}
    />
  );
}
```

---

### Phase 4: Testing & Debugging

#### 4.1 Manual Testing Checklist

- [ ] Set a repo's runtime to "firecracker" in database
- [ ] Open workspace, verify VM creation starts
- [ ] Watch boot progress stepper
- [ ] Switch to Logs tab, verify SSE streaming works
- [ ] Wait for "ready" status
- [ ] Verify preview iframe loads the app
- [ ] Switch to Terminal tab, run `ls -la`
- [ ] Edit a file via AI, verify hot reload
- [ ] Click Stop, verify VM destroys
- [ ] Restart, verify it boots again

#### 4.2 Debug Commands

```bash
# Check host API health
curl http://157.230.181.26:8080/health

# List all VMs on host
curl http://157.230.181.26:8080/api/vms \
  -H "Authorization: Bearer $FIRECRACKER_API_SECRET"

# Check host API logs
ssh root@157.230.181.26 "journalctl -u firecracker-manager -n 100"

# Manually clean up stuck VMs
ssh root@157.230.181.26 "curl -X DELETE http://localhost:8080/api/vms/<id> -H 'Authorization: Bearer \$API_SECRET'"
```

---

## Environment Variables

### Convex Backend

```bash
# Required (add to Convex dashboard)
FIRECRACKER_HOST_URL=http://157.230.181.26:8080
FIRECRACKER_API_SECRET=23c17c1952fa688c07da3f738e1058d83624cad71c91e1ccf4172049f80cb5f5
```

---

## File Structure

```
convex/
  schema.ts                    # Add firecrackerVms table + runtime option
  firecrackerVms.ts           # Queries, mutations, actions
  firecrackerScheduler.ts     # Lifecycle scheduler
  crons.ts                    # Add firecracker cron jobs
  http.ts                     # Add /firecracker-status endpoint

src/components/preview/
  FirecrackerPreview.tsx     # Main preview component (3 tabs)
  FirecrackerLogs.tsx        # SSE log streaming
  FirecrackerTerminal.tsx    # xterm.js WebSocket terminal
  PreviewPanel.tsx           # Add routing for firecracker runtime

# On the Firecracker host (157.230.181.26)
/opt/firecracker/api/server.js  # Extend with setup, exec, logs, terminal endpoints
```

---

## Success Metrics

1. **Boot time**: < 30s from request to ready (including clone + install)
2. **Reliability**: < 5% failure rate
3. **Visibility**: Can identify failure point within 30 seconds via logs
4. **Cost**: $96/month for ~15 concurrent projects (vs $180 for droplets)
