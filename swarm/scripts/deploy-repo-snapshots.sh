#!/bin/bash
#
# Deploy Per-Repository Snapshot Support on Firecracker Host
#
# This script sets up the infrastructure for creating and restoring
# VM snapshots on a per-repository basis, dramatically speeding up
# subsequent VM provisioning for the same repo.
#
# Usage: ./deploy-repo-snapshots.sh
#

set -euo pipefail

HOST="157.230.181.26"
SSH_CMD="ssh root@$HOST"

echo "=== Deploying Per-Repository Snapshot Support ==="

# Step 1: Create directory structure
echo ""
echo "Step 1: Creating snapshot directory structure..."
$SSH_CMD << 'EOF'
set -e

mkdir -p /opt/firecracker/snapshots
chmod 755 /opt/firecracker/snapshots

echo "Created /opt/firecracker/snapshots"
EOF

# Step 2: Deploy snapshot helper functions
echo ""
echo "Step 2: Deploying snapshot helper script..."
$SSH_CMD << 'EOFSCRIPT'
cat > /opt/firecracker/api/snapshot-helpers.js << 'EOF'
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const SNAPSHOTS_DIR = '/opt/firecracker/snapshots';
const VMS_DIR = '/opt/firecracker/vms';
const ROOTFS_BASE = '/opt/firecracker/rootfs/rootfs.ext4';

/**
 * Get the path to a repo's snapshot directory
 */
function getSnapshotPath(owner, repo, branch) {
  const safeBranch = branch.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(SNAPSHOTS_DIR, owner, repo, safeBranch);
}

/**
 * Check if a snapshot exists for a repo/branch
 */
function snapshotExists(owner, repo, branch) {
  const snapshotDir = getSnapshotPath(owner, repo, branch);
  const metadataPath = path.join(snapshotDir, 'metadata.json');
  return fs.existsSync(metadataPath);
}

/**
 * Get snapshot metadata
 */
function getSnapshotMetadata(owner, repo, branch) {
  const snapshotDir = getSnapshotPath(owner, repo, branch);
  const metadataPath = path.join(snapshotDir, 'metadata.json');
  
  if (!fs.existsSync(metadataPath)) {
    return null;
  }
  
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (err) {
    console.error(`Error reading snapshot metadata: ${err.message}`);
    return null;
  }
}

/**
 * Create a snapshot of a running VM
 * VM must be in a state where it can be paused (after install, before dev server)
 */
async function createRepoSnapshot(vm, owner, repo, branch, commitSha = 'unknown') {
  const snapshotDir = getSnapshotPath(owner, repo, branch);
  const lockFile = path.join(snapshotDir, '.lock');
  
  console.log(`[snapshot] Creating snapshot for ${owner}/${repo}@${branch}`);
  
  // Create directory
  fs.mkdirSync(snapshotDir, { recursive: true });
  
  // Simple lock (could be improved with proper flock)
  if (fs.existsSync(lockFile)) {
    const lockAge = Date.now() - fs.statSync(lockFile).mtimeMs;
    if (lockAge < 300000) { // 5 minutes
      throw new Error('Snapshot creation already in progress');
    }
  }
  fs.writeFileSync(lockFile, `${process.pid}\n${Date.now()}`);
  
  try {
    const socketPath = path.join(VMS_DIR, vm.id, 'firecracker.sock');
    const memPath = path.join(snapshotDir, 'mem');
    const statePath = path.join(snapshotDir, 'state');
    const rootfsPath = path.join(snapshotDir, 'rootfs.ext4');
    const vmRootfs = path.join(VMS_DIR, vm.id, 'rootfs.ext4');
    
    // 0. Check current VM state first
    console.log(`[snapshot] Checking VM ${vm.id} state...`);
    let vmState;
    try {
      vmState = await firecrackerApiCall(socketPath, 'GET', '/vm');
      console.log(`[snapshot] Current VM state: ${JSON.stringify(vmState)}`);
    } catch (err) {
      console.log(`[snapshot] Could not get VM state: ${err.message}`);
    }
    
    // 1. Pause VM (only if not already paused)
    const currentState = vmState?.state || 'Running';
    if (currentState !== 'Paused') {
      console.log(`[snapshot] Pausing VM ${vm.id} (current state: ${currentState})...`);
      try {
        await firecrackerApiCall(socketPath, 'PATCH', '/vm', { state: 'Paused' });
      } catch (err) {
        // If pause fails, snapshot creation will also fail - let it bubble up with context
        throw new Error(`Failed to pause VM: ${err.message}`);
      }
      
      // Wait for pause to fully take effect (Firecracker needs a moment)
      console.log(`[snapshot] Waiting for pause to complete...`);
      await new Promise(r => setTimeout(r, 500));
      
      // Verify VM is actually paused
      try {
        const postPauseState = await firecrackerApiCall(socketPath, 'GET', '/vm');
        console.log(`[snapshot] Post-pause state: ${JSON.stringify(postPauseState)}`);
        if (postPauseState?.state !== 'Paused') {
          throw new Error(`VM failed to pause, state is: ${postPauseState?.state}`);
        }
      } catch (verifyErr) {
        console.log(`[snapshot] Could not verify pause: ${verifyErr.message}`);
        // Continue anyway - the snapshot create will fail if not paused
      }
    } else {
      console.log(`[snapshot] VM already paused, proceeding with snapshot`);
    }
    
    // 2. Create snapshot
    console.log(`[snapshot] Creating snapshot files...`);
    try {
      await firecrackerApiCall(socketPath, 'PUT', '/snapshot/create', {
        snapshot_type: 'Full',
        snapshot_path: statePath,
        mem_file_path: memPath,
      });
    } catch (err) {
      // If snapshot fails, try to resume VM before re-throwing
      console.error(`[snapshot] Snapshot creation failed: ${err.message}`);
      try {
        await firecrackerApiCall(socketPath, 'PATCH', '/vm', { state: 'Resumed' });
      } catch (resumeErr) {
        console.error(`[snapshot] Failed to resume after snapshot error: ${resumeErr.message}`);
      }
      throw err;
    }
    
    // 3. Copy rootfs (CoW if available)
    console.log(`[snapshot] Copying rootfs...`);
    copyRootfs(vmRootfs, rootfsPath);
    
    // 4. Resume VM
    console.log(`[snapshot] Resuming VM...`);
    await firecrackerApiCall(socketPath, 'PATCH', '/vm', { state: 'Resumed' });
    
    // 5. Write metadata
    const metadata = {
      createdAt: Date.now(),
      repoUrl: `https://github.com/${owner}/${repo}`,
      branch,
      commitSha,
      firecrackerVersion: getFirecrackerVersion(),
      memoryMb: vm.memory || 2048,
      vcpus: vm.vcpus || 2,
      sizeBytes: {
        memory: fs.statSync(memPath).size,
        state: fs.statSync(statePath).size,
        rootfs: fs.statSync(rootfsPath).size,
      },
    };
    fs.writeFileSync(path.join(snapshotDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
    
    console.log(`[snapshot] Snapshot created successfully`);
    return metadata;
    
  } finally {
    // Release lock
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
  }
}

/**
 * Create a new VM from a snapshot
 * Returns the new VM info, similar to createVm()
 */
async function restoreFromSnapshot(owner, repo, branch, vmName, ports = [3000]) {
  const snapshotDir = getSnapshotPath(owner, repo, branch);
  const metadata = getSnapshotMetadata(owner, repo, branch);
  
  if (!metadata) {
    throw new Error(`No snapshot found for ${owner}/${repo}@${branch}`);
  }
  
  console.log(`[snapshot] Restoring from snapshot for ${owner}/${repo}@${branch}`);
  
  // Generate VM ID
  const vmId = generateVmId();
  const vmDir = path.join(VMS_DIR, vmId);
  fs.mkdirSync(vmDir, { recursive: true });
  
  // 1. Copy-on-write clone of rootfs
  const snapshotRootfs = path.join(snapshotDir, 'rootfs.ext4');
  const vmRootfs = path.join(vmDir, 'rootfs.ext4');
  console.log(`[snapshot] Creating CoW clone of rootfs...`);
  copyRootfs(snapshotRootfs, vmRootfs);
  
  // 2. Set up networking
  const { tapDevice, vmIp, hostPorts } = await setupNetworking(vmId, ports);
  
  // 3. Create Firecracker config for snapshot restore
  const socketPath = path.join(vmDir, 'firecracker.sock');
  const logPath = path.join(vmDir, 'firecracker.log');
  
  // 4. Start Firecracker process
  console.log(`[snapshot] Starting Firecracker process...`);
  const fcProcess = spawn('firecracker', [
    '--api-sock', socketPath,
    '--log-path', logPath,
    '--level', 'Info',
  ], {
    cwd: vmDir,
    detached: true,
    stdio: 'ignore',
  });
  fcProcess.unref();
  
  // Wait for socket
  await waitForSocket(socketPath);
  
  // 5. Configure drives (must be done before snapshot load)
  console.log(`[snapshot] Configuring drives...`);
  await firecrackerApiCall(socketPath, 'PUT', '/drives/rootfs', {
    drive_id: 'rootfs',
    path_on_host: vmRootfs,
    is_root_device: true,
    is_read_only: false,
  });
  
  // 6. Configure network
  await firecrackerApiCall(socketPath, 'PUT', `/network-interfaces/${tapDevice}`, {
    iface_id: tapDevice,
    host_dev_name: tapDevice,
    guest_mac: generateMac(vmId),
  });
  
  // 7. Load snapshot
  console.log(`[snapshot] Loading snapshot...`);
  const memPath = path.join(snapshotDir, 'mem');
  const statePath = path.join(snapshotDir, 'state');
  
  await firecrackerApiCall(socketPath, 'PUT', '/snapshot/load', {
    snapshot_path: statePath,
    mem_backend: {
      backend_path: memPath,
      backend_type: 'File',
    },
    resume_vm: true,
  });
  
  console.log(`[snapshot] VM restored and resumed`);
  
  // 8. Store VM info
  const vmInfo = {
    id: vmId,
    name: vmName,
    status: 'running',
    ip: vmIp,
    ports: hostPorts.map((host, i) => ({ guest: ports[i], host })),
    memory: metadata.memoryMb,
    vcpus: metadata.vcpus,
    restoredFrom: `${owner}/${repo}@${branch}`,
    pid: fcProcess.pid,
  };
  
  fs.writeFileSync(path.join(vmDir, 'config.json'), JSON.stringify(vmInfo, null, 2));
  
  return vmInfo;
}

/**
 * Delete a snapshot
 */
function deleteSnapshot(owner, repo, branch) {
  const snapshotDir = getSnapshotPath(owner, repo, branch);
  
  if (!fs.existsSync(snapshotDir)) {
    return false;
  }
  
  console.log(`[snapshot] Deleting snapshot for ${owner}/${repo}@${branch}`);
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  
  // Clean up empty parent directories
  const repoDir = path.dirname(snapshotDir);
  if (fs.existsSync(repoDir) && fs.readdirSync(repoDir).length === 0) {
    fs.rmdirSync(repoDir);
    const ownerDir = path.dirname(repoDir);
    if (fs.existsSync(ownerDir) && fs.readdirSync(ownerDir).length === 0) {
      fs.rmdirSync(ownerDir);
    }
  }
  
  return true;
}

/**
 * List all snapshots
 */
function listSnapshots() {
  const snapshots = [];
  
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    return snapshots;
  }
  
  for (const owner of fs.readdirSync(SNAPSHOTS_DIR)) {
    const ownerDir = path.join(SNAPSHOTS_DIR, owner);
    if (!fs.statSync(ownerDir).isDirectory()) continue;
    
    for (const repo of fs.readdirSync(ownerDir)) {
      const repoDir = path.join(ownerDir, repo);
      if (!fs.statSync(repoDir).isDirectory()) continue;
      
      for (const branch of fs.readdirSync(repoDir)) {
        const metadata = getSnapshotMetadata(owner, repo, branch);
        if (metadata) {
          snapshots.push({
            owner,
            repo,
            branch,
            ...metadata,
          });
        }
      }
    }
  }
  
  return snapshots;
}

// Helper: Make API call to Firecracker via Unix socket
async function firecrackerApiCall(socketPath, method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    
    const options = {
      socketPath,
      path: endpoint,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : null);
        } else {
          reject(new Error(`Firecracker API error: ${res.statusCode} ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Helper: Copy rootfs with CoW if available
function copyRootfs(src, dst) {
  // Try reflink first (instant, CoW)
  try {
    execSync(`cp --reflink=always "${src}" "${dst}"`, { stdio: 'pipe' });
    return;
  } catch (e) {
    // Reflink not supported
  }
  
  // Fall back to sparse copy
  execSync(`cp --sparse=always "${src}" "${dst}"`);
}

// Helper: Wait for socket to be available
async function waitForSocket(socketPath, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fs.existsSync(socketPath)) {
      return;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timeout waiting for socket: ${socketPath}`);
}

// Helper: Generate VM ID
function generateVmId() {
  return Math.random().toString(36).substring(2, 10);
}

// Helper: Get Firecracker version
function getFirecrackerVersion() {
  try {
    return execSync('firecracker --version', { encoding: 'utf8' }).trim().split(' ')[1];
  } catch {
    return 'unknown';
  }
}

// Helper: Generate MAC address from VM ID
function generateMac(vmId) {
  const hash = vmId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `02:FC:00:00:${(hash & 0xFF).toString(16).padStart(2, '0')}:${((hash >> 8) & 0xFF).toString(16).padStart(2, '0')}`;
}

// Placeholder - these would be imported from the main server.js
async function setupNetworking(vmId, ports) {
  // This function should be implemented in or imported from server.js
  throw new Error('setupNetworking must be implemented in server.js integration');
}

module.exports = {
  getSnapshotPath,
  snapshotExists,
  getSnapshotMetadata,
  createRepoSnapshot,
  restoreFromSnapshot,
  deleteSnapshot,
  listSnapshots,
};
EOF

chmod 644 /opt/firecracker/api/snapshot-helpers.js
echo "Created /opt/firecracker/api/snapshot-helpers.js"
EOFSCRIPT

# Step 3: Create cleanup cron job
echo ""
echo "Step 3: Setting up snapshot cleanup cron..."
$SSH_CMD << 'EOF'
cat > /opt/firecracker/api/cleanup-snapshots.sh << 'SCRIPT'
#!/bin/bash
# Clean up snapshots not accessed in 7+ days

SNAPSHOTS_DIR="/opt/firecracker/snapshots"
MAX_AGE_DAYS=7

find "$SNAPSHOTS_DIR" -name "metadata.json" -type f -atime +$MAX_AGE_DAYS | while read metadata; do
    snapshot_dir=$(dirname "$metadata")
    echo "Cleaning up old snapshot: $snapshot_dir"
    rm -rf "$snapshot_dir"
done

# Clean up empty directories
find "$SNAPSHOTS_DIR" -type d -empty -delete 2>/dev/null || true
SCRIPT

chmod +x /opt/firecracker/api/cleanup-snapshots.sh

# Add to crontab if not present
if ! crontab -l 2>/dev/null | grep -q "cleanup-snapshots"; then
    (crontab -l 2>/dev/null; echo "0 3 * * * /opt/firecracker/api/cleanup-snapshots.sh >> /var/log/snapshot-cleanup.log 2>&1") | crontab -
    echo "Added cleanup cron job (runs daily at 3am)"
else
    echo "Cleanup cron job already exists"
fi
EOF

# Step 4: Add API endpoints to server.js
echo ""
echo "Step 4: Adding snapshot API endpoints to server.js..."
$SSH_CMD << 'EOFPATCH'
set -e

SERVER_FILE="/opt/firecracker/api/server.js"

# Check if snapshot endpoints already exist
if grep -q "snapshot-helpers" "$SERVER_FILE"; then
    echo "Snapshot endpoints already integrated in server.js"
    exit 0
fi

# Backup
cp "$SERVER_FILE" "${SERVER_FILE}.backup.$(date +%Y%m%d%H%M%S)"

# Add require statement after other requires
node << 'NODEJS_EOF'
const fs = require('fs');
const serverPath = '/opt/firecracker/api/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find a good place to add the require (after existing requires)
const requirePattern = /const \{ execSync[^}]+\} = require\(['"]child_process['"]\);?/;
const match = content.match(requirePattern);

if (!match) {
    console.error('Could not find child_process require to insert after');
    process.exit(1);
}

const insertPoint = match.index + match[0].length;
const snapshotRequire = `

// Snapshot support
const snapshotHelpers = require('./snapshot-helpers.js');
`;

content = content.slice(0, insertPoint) + snapshotRequire + content.slice(insertPoint);
fs.writeFileSync(serverPath, content);
console.log('Added snapshot-helpers require');
NODEJS_EOF

# Add API endpoints before the server.listen call
node << 'NODEJS_EOF'
const fs = require('fs');
const serverPath = '/opt/firecracker/api/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find server.listen to insert before
const listenPattern = /server\.listen\(\s*PORT/;
const match = content.match(listenPattern);

if (!match) {
    console.error('Could not find server.listen to insert before');
    process.exit(1);
}

const insertPoint = match.index;
const snapshotEndpoints = `
// ============================================
// Snapshot API Endpoints
// ============================================

// Get snapshot info
app.get('/api/snapshots/:owner/:repo/:branch', requireAuth, (req, res) => {
  const { owner, repo, branch } = req.params;
  const metadata = snapshotHelpers.getSnapshotMetadata(owner, repo, branch);
  
  if (!metadata) {
    return res.status(404).json({ error: 'Snapshot not found' });
  }
  
  res.json({ owner, repo, branch, ...metadata });
});

// List all snapshots
app.get('/api/snapshots', requireAuth, (req, res) => {
  const snapshots = snapshotHelpers.listSnapshots();
  res.json({ snapshots });
});

// Create snapshot from running VM
app.post('/api/vms/:id/snapshot', requireAuth, async (req, res) => {
  const vm = vms.get(req.params.id);
  if (!vm) {
    return res.status(404).json({ error: 'VM not found' });
  }
  
  const { owner, repo, branch, commitSha } = req.body;
  if (!owner || !repo || !branch) {
    return res.status(400).json({ error: 'owner, repo, and branch are required' });
  }
  
  try {
    const metadata = await snapshotHelpers.createRepoSnapshot(vm, owner, repo, branch, commitSha);
    res.json({ success: true, ...metadata });
  } catch (err) {
    console.error(\`[snapshot] Error creating snapshot: \${err.message}\`);
    res.status(500).json({ error: err.message });
  }
});

// Restore VM from snapshot
app.post('/api/snapshots/restore', requireAuth, async (req, res) => {
  const { owner, repo, branch, name, ports } = req.body;
  
  if (!owner || !repo || !branch) {
    return res.status(400).json({ error: 'owner, repo, and branch are required' });
  }
  
  if (!snapshotHelpers.snapshotExists(owner, repo, branch)) {
    return res.status(404).json({ error: 'Snapshot not found' });
  }
  
  try {
    // Note: restoreFromSnapshot needs setupNetworking to be accessible
    // This requires further integration with the main server.js VM creation code
    const vmInfo = await snapshotHelpers.restoreFromSnapshot(
      owner, repo, branch,
      name || \`restored-\${repo}\`,
      ports || [3000]
    );
    
    // Register VM in our tracking
    vms.set(vmInfo.id, vmInfo);
    
    res.status(201).json(vmInfo);
  } catch (err) {
    console.error(\`[snapshot] Error restoring snapshot: \${err.message}\`);
    res.status(500).json({ error: err.message });
  }
});

// Delete snapshot
app.delete('/api/snapshots/:owner/:repo/:branch', requireAuth, (req, res) => {
  const { owner, repo, branch } = req.params;
  
  const deleted = snapshotHelpers.deleteSnapshot(owner, repo, branch);
  
  if (!deleted) {
    return res.status(404).json({ error: 'Snapshot not found' });
  }
  
  res.json({ success: true });
});

`;

content = content.slice(0, insertPoint) + snapshotEndpoints + content.slice(insertPoint);
fs.writeFileSync(serverPath, content);
console.log('Added snapshot API endpoints');
NODEJS_EOF

echo "Restarting firecracker-manager service..."
systemctl restart firecracker-manager
sleep 2
EOFPATCH

# Step 5: Verify
echo ""
echo "Step 5: Verifying deployment..."
$SSH_CMD << 'EOF'
echo "Directory structure:"
ls -la /opt/firecracker/snapshots/ 2>/dev/null || echo "(empty)"

echo ""
echo "Snapshot helpers:"
ls -la /opt/firecracker/api/snapshot-helpers.js

echo ""
echo "Service status:"
systemctl status firecracker-manager --no-pager | head -5

echo ""
echo "Testing snapshot list endpoint..."
curl -s -H "Authorization: Bearer $(cat /opt/firecracker/.env | grep API_SECRET | cut -d= -f2)" \
    http://localhost:8080/api/snapshots | head -c 200 || echo "(endpoint may need further integration)"
EOF

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Snapshot infrastructure is now available!"
echo ""
echo "API Endpoints:"
echo "  GET    /api/snapshots                     - List all snapshots"
echo "  GET    /api/snapshots/:owner/:repo/:branch - Get snapshot info"
echo "  POST   /api/vms/:id/snapshot              - Create snapshot from running VM"
echo "  POST   /api/snapshots/restore             - Create VM from snapshot"
echo "  DELETE /api/snapshots/:owner/:repo/:branch - Delete snapshot"
echo ""
echo "Next steps:"
echo "  1. Integrate snapshot creation into VM setup flow (after install, before dev server)"
echo "  2. Modify Convex VM request logic to check for and use snapshots"
echo "  3. Add UI for snapshot management"
echo ""
echo "Note: The restoreFromSnapshot function needs setupNetworking integration."
echo "See snapshot-helpers.js for the TODO."
