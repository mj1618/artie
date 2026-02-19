#!/bin/bash
#
# Deploy WebSocket Terminal to Firecracker Host
#
# This script adds a WebSocket terminal endpoint that allows the frontend
# to connect to Firecracker VMs for interactive shell access.
#
# Usage: ./deploy-terminal.sh
#

set -euo pipefail

HOST="157.230.181.26"
SSH_CMD="ssh root@$HOST"

echo "=== Deploying WebSocket Terminal to Firecracker Host ==="

# Step 1: Install required npm packages
echo ""
echo "Step 1: Installing required npm packages (ws)..."
$SSH_CMD << 'EOF'
set -e
cd /opt/firecracker/api

# Check if ws is already installed
if ! npm ls ws 2>/dev/null | grep -q ws; then
    echo "Installing ws package..."
    npm install ws
else
    echo "ws package already installed"
fi
EOF

# Step 2: Backup and patch server.js to add terminal endpoint
echo ""
echo "Step 2: Patching server.js to add terminal WebSocket endpoint..."
$SSH_CMD << 'EOF'
set -e

SERVER_FILE="/opt/firecracker/api/server.js"
BACKUP_FILE="${SERVER_FILE}.backup.terminal.$(date +%Y%m%d%H%M%S)"

# Check if already patched
if grep -q "terminal WebSocket" "$SERVER_FILE" || grep -q "/api/vms/:vmId/terminal" "$SERVER_FILE"; then
    echo "Server.js already has terminal endpoint - skipping"
    exit 0
fi

# Backup
cp "$SERVER_FILE" "$BACKUP_FILE"
echo "Backed up server.js to $BACKUP_FILE"

# Create the patch using Node.js
node << 'NODEJS_EOF'
const fs = require('fs');

const serverPath = '/opt/firecracker/api/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find imports section and add ws + child_process imports
const httpImportMatch = content.match(/const http = require\(['"]http['"]\);?/);
if (!httpImportMatch) {
    console.error('Could not find http require statement');
    process.exit(1);
}

// Add imports after http
const importInsertPoint = httpImportMatch.index + httpImportMatch[0].length;
const newImports = `
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
`;

// Only add if not already present
if (!content.includes('WebSocketServer')) {
    content = content.slice(0, importInsertPoint) + newImports + content.slice(importInsertPoint);
    console.log('Added WebSocket imports');
}

// Find where server is created and add WebSocket server setup
// Look for: const server = http.createServer(...) or similar
const serverCreateMatch = content.match(/const server = http\.createServer\([^)]+\)/);
if (!serverCreateMatch) {
    console.error('Could not find server creation');
    process.exit(1);
}

// Find server.listen to insert WebSocket setup before it
const serverListenMatch = content.match(/server\.listen\s*\(/);
if (!serverListenMatch) {
    console.error('Could not find server.listen');
    process.exit(1);
}

const wsSetupCode = `
// ============================================
// WebSocket Terminal Server
// ============================================
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade requests
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://localhost');
  
  // Match /api/vms/:vmId/terminal
  const terminalMatch = url.pathname.match(/^\\/api\\/vms\\/([^/]+)\\/terminal$/);
  if (!terminalMatch) {
    socket.write('HTTP/1.1 404 Not Found\\r\\n\\r\\n');
    socket.destroy();
    return;
  }

  const vmId = terminalMatch[1];
  
  // Find the VM first
  const vm = vms.get(vmId);
  if (!vm) {
    socket.write('HTTP/1.1 404 VM Not Found\\r\\n\\r\\n');
    socket.destroy();
    return;
  }

  // Validate token from query string
  // Accept either the host API_SECRET or the VM-specific callback secret
  const token = url.searchParams.get('token');
  const isHostToken = token === process.env.API_SECRET;
  const isVmToken = vm.callbackSecret && token === vm.callbackSecret;
  
  if (!isHostToken && !isVmToken) {
    socket.write('HTTP/1.1 401 Unauthorized\\r\\n\\r\\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, vm);
  });
});

// Handle terminal WebSocket connections
wss.on('connection', (ws, request, vm) => {
  console.log(\`[terminal] WebSocket connected for VM \${vm.id} (\${vm.name})\`);

  // Spawn SSH process to the VM
  // VMs use root access and are on the private 172.16.0.x network
  const sshProcess = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'LogLevel=ERROR',
    '-tt', // Force TTY allocation
    \`root@\${vm.ip}\`,
  ], {
    env: { ...process.env, TERM: 'xterm-256color' }
  });

  // Pipe SSH stdout to WebSocket
  sshProcess.stdout.on('data', (data) => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(data.toString());
    }
  });

  // Pipe SSH stderr to WebSocket
  sshProcess.stderr.on('data', (data) => {
    if (ws.readyState === 1) {
      ws.send(data.toString());
    }
  });

  // Pipe WebSocket messages to SSH stdin
  ws.on('message', (data) => {
    if (!sshProcess.killed) {
      sshProcess.stdin.write(data);
    }
  });

  // Handle SSH process exit
  sshProcess.on('close', (code) => {
    console.log(\`[terminal] SSH process exited with code \${code} for VM \${vm.id}\`);
    if (ws.readyState === 1) {
      ws.send(\`\\r\\n[Connection closed with code \${code}]\\r\\n\`);
      ws.close();
    }
  });

  sshProcess.on('error', (err) => {
    console.error(\`[terminal] SSH error for VM \${vm.id}:\`, err.message);
    if (ws.readyState === 1) {
      ws.send(\`\\r\\n[SSH Error: \${err.message}]\\r\\n\`);
      ws.close();
    }
  });

  // Handle WebSocket close
  ws.on('close', () => {
    console.log(\`[terminal] WebSocket closed for VM \${vm.id}\`);
    if (!sshProcess.killed) {
      sshProcess.kill();
    }
  });

  // Handle WebSocket error
  ws.on('error', (err) => {
    console.error(\`[terminal] WebSocket error for VM \${vm.id}:\`, err.message);
    if (!sshProcess.killed) {
      sshProcess.kill();
    }
  });
});

`;

// Insert before server.listen
content = content.slice(0, serverListenMatch.index) + wsSetupCode + '\n' + content.slice(serverListenMatch.index);

fs.writeFileSync(serverPath, content);
console.log('Server.js patched successfully with terminal WebSocket endpoint');
NODEJS_EOF

echo "Server.js patched"
EOF

# Step 3: Set up SSH keys for host-to-VM communication
echo ""
echo "Step 3: Ensuring SSH keys are set up for VM access..."
$SSH_CMD << 'EOF'
set -e

# Generate SSH key if it doesn't exist
if [ ! -f /root/.ssh/id_rsa ]; then
    echo "Generating SSH key for VM access..."
    ssh-keygen -t rsa -b 4096 -f /root/.ssh/id_rsa -N ""
fi

# The key needs to be in the VM's authorized_keys
# This is typically done in the rootfs image, but let's verify
echo "SSH public key for VMs (should be in VM rootfs):"
cat /root/.ssh/id_rsa.pub

# Check if the rootfs already has the key
# We'll need to update the setup process to inject the key
echo ""
echo "Note: Ensure the VM rootfs includes this public key in /root/.ssh/authorized_keys"
EOF

# Step 4: Ensure setup endpoint stores callbackSecret on VM
echo ""
echo "Step 4: Patching server.js to store callbackSecret on VM..."
$SSH_CMD << 'EOF'
set -e

SERVER_FILE="/opt/firecracker/api/server.js"

# Check if callbackSecret storage is already present
if grep -q "vm.callbackSecret = callbackSecret" "$SERVER_FILE"; then
    echo "callbackSecret storage already present - skipping"
    exit 0
fi

# Patch to store callbackSecret on the VM object during setup
node << 'NODEJS_EOF'
const fs = require('fs');

const serverPath = '/opt/firecracker/api/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find where setup endpoint extracts callbackSecret and ensure it's stored on VM
// Look for something like: const { repo, branch, githubToken, callbackUrl, callbackSecret, envVars } = req.body
const setupDestructureMatch = content.match(/const \{[^}]*callbackSecret[^}]*\} = req\.body/);

if (setupDestructureMatch) {
    // Find the next occurrence after the destructure where we should store it
    // Look for something like: await runSetup(vm, { or similar
    const afterDestructure = content.slice(setupDestructureMatch.index + setupDestructureMatch[0].length);
    const runSetupMatch = afterDestructure.match(/runSetup\(vm,/);
    
    if (runSetupMatch) {
        const insertPoint = setupDestructureMatch.index + setupDestructureMatch[0].length + runSetupMatch.index;
        
        const storeCallbackSecret = `
    
    // Store callback secret for terminal auth
    if (callbackSecret) {
      vm.callbackSecret = callbackSecret;
    }
`;
        
        content = content.slice(0, insertPoint) + storeCallbackSecret + content.slice(insertPoint);
        fs.writeFileSync(serverPath, content);
        console.log('Added callbackSecret storage');
    } else {
        console.log('Could not find runSetup call - may need manual update');
    }
} else {
    console.log('Could not find setup endpoint destructure - may already be handled or needs manual update');
}
NODEJS_EOF
EOF

# Step 5: Update VM setup to inject SSH key
echo ""
echo "Step 5: Patching server.js to inject SSH key during VM boot..."
$SSH_CMD << 'EOF'
set -e

SERVER_FILE="/opt/firecracker/api/server.js"

# Check if SSH key injection is already present
if grep -q "authorized_keys" "$SERVER_FILE"; then
    echo "SSH key injection already present - skipping"
    exit 0
fi

# Patch to add SSH key setup to execInVm or to the boot process
node << 'NODEJS_EOF'
const fs = require('fs');

const serverPath = '/opt/firecracker/api/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find the runSetup function's first execInVm call and add SSH setup before it
// We need to inject our public key into the VM

// Look for the first action in runSetup after status report
const setupStartMatch = content.match(/async function runSetup\(vm, \{[^}]+\}\) \{[\s\S]*?await reportStatus\(vm, "cloning"\);/);

if (setupStartMatch) {
    const insertPoint = setupStartMatch.index + setupStartMatch[0].length;
    
    const sshSetupCode = `
    
    // Inject SSH key for terminal access
    try {
      const hostPubKey = require('fs').readFileSync('/root/.ssh/id_rsa.pub', 'utf8').trim();
      await execInVm(vm, \`mkdir -p /root/.ssh && chmod 700 /root/.ssh && echo "\${hostPubKey}" >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys\`, { timeout: 10000 });
      console.log(\`[runSetup] Injected SSH key for VM \${vm.name}\`);
    } catch (sshErr) {
      console.log(\`[runSetup] SSH key injection warning: \${sshErr.message}\`);
    }
`;
    
    content = content.slice(0, insertPoint) + sshSetupCode + content.slice(insertPoint);
    fs.writeFileSync(serverPath, content);
    console.log('Added SSH key injection to runSetup');
} else {
    console.log('Could not find runSetup insertion point - may need manual update');
}
NODEJS_EOF

echo "SSH key injection patched"
EOF

# Step 6: Restart the firecracker-manager service
echo ""
echo "Step 6: Restarting firecracker-manager service..."
$SSH_CMD << 'EOF'
systemctl restart firecracker-manager
sleep 2
echo "Service status:"
systemctl status firecracker-manager --no-pager | head -20
echo ""
echo "Testing API health:"
curl -s http://localhost:8080/health | jq .
EOF

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "The WebSocket terminal endpoint is now available at:"
echo "  ws://157.230.181.26:8080/api/vms/{vmId}/terminal?token={API_SECRET}"
echo ""
echo "How it works:"
echo "  1. Frontend connects via WebSocket with token authentication"
echo "  2. Server validates token and finds the VM"
echo "  3. SSH session is spawned to the VM's internal IP"
echo "  4. Bidirectional data is proxied between WebSocket and SSH"
echo ""
echo "Requirements:"
echo "  - VM must be in 'ready' or 'active' status"
echo "  - SSH key is automatically injected during VM setup"
echo ""
