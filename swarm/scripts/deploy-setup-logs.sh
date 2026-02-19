#!/bin/bash
#
# Deploy Setup Log Streaming to Firecracker Host
#
# This script adds the execInVmWithLogs function to stream pnpm install
# output to the frontend logs in real-time.
#
# Usage: ./deploy-setup-logs.sh
#

set -euo pipefail

HOST="157.230.181.26"
SSH_CMD="ssh root@$HOST"

echo "=== Deploying Setup Log Streaming to Firecracker Host ==="

# Step 1: Backup server.js
echo ""
echo "Step 1: Backing up server.js..."
$SSH_CMD "cp /opt/firecracker/api/server.js /opt/firecracker/api/server.js.backup.\$(date +%Y%m%d%H%M%S)"

# Step 2: Check if already patched
echo ""
echo "Step 2: Checking current state..."
if $SSH_CMD "grep -q 'function execInVmWithLogs' /opt/firecracker/api/server.js"; then
    echo "execInVmWithLogs already exists - checking if install section uses it..."
    if $SSH_CMD "grep -q 'execInVmWithLogs.*installCmd' /opt/firecracker/api/server.js"; then
        echo "Already fully patched!"
        exit 0
    fi
fi

# Step 3: Add execInVmWithLogs function after execInVm
echo ""
echo "Step 3: Adding execInVmWithLogs function..."
$SSH_CMD << 'EOF'
# Find the line number where execInVm function ends
END_LINE=$(grep -n "^}" /opt/firecracker/api/server.js | awk -F: '$1 > 627 {print $1; exit}')

if [ -z "$END_LINE" ]; then
    echo "Could not find end of execInVm function"
    exit 1
fi

# Create the new function
cat > /tmp/new_function.js << 'FUNCEOF'

// Execute command in VM with real-time log streaming
async function execInVmWithLogs(vm, command, vmId, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const prefix = options.prefix || '';
    
    if (vmId) appendLog(vmId, prefix + '$ ' + command);
    
    const proc = spawn("ssh", [
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      "-o", "ConnectTimeout=3",
      `root@${vm.ip}`,
      command,
    ]);

    let stdout = "";
    let stderr = "";
    
    // Stream stdout in real-time
    proc.stdout.on("data", (d) => {
      const text = d.toString();
      stdout += text;
      if (vmId) {
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            appendLog(vmId, prefix + line);
          }
        }
      }
    });
    
    // Stream stderr in real-time  
    proc.stderr.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      if (vmId) {
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            appendLog(vmId, prefix + line);
          }
        }
      }
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill(); } catch (e) {}
      if (vmId) appendLog(vmId, 'ERROR: Command timed out');
      reject(new Error("Command timed out"));
    }, options.timeout || 60000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ exitCode: code, stdout, stderr });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (vmId) appendLog(vmId, 'ERROR: ' + err.message);
      reject(err);
    });
  });
}
FUNCEOF

# Insert after the execInVm function ends
sed -i "${END_LINE}r /tmp/new_function.js" /opt/firecracker/api/server.js
echo "Function inserted after line $END_LINE"
EOF

# Step 4: Update install section to use execInVmWithLogs
echo ""
echo "Step 4: Updating install section..."
$SSH_CMD << 'EOF'
node << 'NODEJS'
const fs = require('fs');

const serverPath = '/opt/firecracker/api/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// First, add the "Running:" log line before the install
const installPattern = /const installResult = await execInVm\(\s*vm,\s*`\$\{installCmd\} 2>&1`,/;
const match = content.match(installPattern);
if (match) {
    content = content.replace(
        installPattern,
        `if (vmId) appendLog(vmId, "Running: " + installCmd);
      const installResult = await execInVmWithLogs(vm, \`\${installCmd} 2>&1\`, vmId,`
    );
    fs.writeFileSync(serverPath, content);
    console.log('Updated install to use execInVmWithLogs');
} else {
    console.log('Install pattern not found - may already be patched');
}
NODEJS
EOF

# Step 5: Restart service
echo ""
echo "Step 5: Restarting firecracker-manager service..."
$SSH_CMD << 'EOF'
systemctl restart firecracker-manager
sleep 2
echo "Service status:"
systemctl status firecracker-manager --no-pager | head -10
echo ""
echo "API health:"
curl -s http://localhost:8080/health | jq .
EOF

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "pnpm install output will now stream to the frontend Logs tab."
echo ""
echo "What you'll see:"
echo "  - Running: pnpm install"
echo "  - [pnpm output line by line...]"
echo "  - Dependencies installed successfully"
echo ""
