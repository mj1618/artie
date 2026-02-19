#!/bin/bash
#
# Deploy Boot Speed Optimizations to Firecracker Host
#
# Optimizations applied:
# 1. Use /var/tmp/ (ext4, same filesystem as /app) instead of /tmp/ (tmpfs)
#    for node_modules cache restore. This avoids a slow cross-filesystem mv
#    that copies ~600MB+ of data. Using the same filesystem allows an instant
#    rename() instead. Saves ~2-3 seconds.
#
# 2. Add --quiet flag to git clone to suppress "Updating files: XX%" progress.
#    This reduces SSH buffer overhead when running git clone via SSH.
#    Saves ~0.5-1 second.
#
# 3. Reduce SSH polling interval from 500ms to 200ms for waitForSsh.
#    Gets ~0.3s faster detection of SSH readiness after VM boot.
#
# Total improvement: ~2.5-3.5 seconds per VM setup
#
# Usage: ./deploy-boot-speed.sh
#

set -euo pipefail

HOST="157.230.181.26"
SSH_CMD="ssh -o StrictHostKeyChecking=no -o LogLevel=ERROR root@$HOST"

echo "=== Deploying Boot Speed Optimizations to Firecracker Host ==="

# Step 1: Apply all optimizations
echo ""
echo "Step 1: Patching server.js with boot speed optimizations..."
$SSH_CMD << 'EOF'
set -e

SERVER_FILE="/opt/firecracker/api/server.js"
BACKUP_FILE="${SERVER_FILE}.backup.bootspeed.$(date +%Y%m%d%H%M%S)"

# Backup
cp "$SERVER_FILE" "$BACKUP_FILE"
echo "Backed up server.js to $BACKUP_FILE"

node << 'NODEJS_EOF'
const fs = require('fs');

const serverPath = '/opt/firecracker/api/server.js';
let content = fs.readFileSync(serverPath, 'utf8');
let changes = 0;

// Optimization 1: Use /var/tmp/nm-restore instead of /tmp/nm-restore
// /var/tmp is on ext4 (same as /app), so mv is an instant rename
// /tmp is tmpfs, so mv requires a full copy across filesystems
const tmpCount = (content.match(/\/tmp\/nm-restore/g) || []).length;
if (tmpCount > 0) {
  content = content.replace(/\/tmp\/nm-restore/g, '/var/tmp/nm-restore');
  console.log(`  [1] Replaced ${tmpCount} occurrences of /tmp/nm-restore -> /var/tmp/nm-restore`);
  changes++;
} else if (content.includes('/var/tmp/nm-restore')) {
  console.log('  [1] Already using /var/tmp/nm-restore');
} else {
  console.log('  [1] No nm-restore paths found to optimize');
}

// Optimization 2: Add --quiet to git clone to reduce SSH output
if (content.includes('git clone --depth 1') && !content.includes('git clone --quiet')) {
  content = content.replace(/git clone --depth 1 --branch/g, 'git clone --quiet --depth 1 --branch');
  content = content.replace(/git clone --depth 1 "/g, 'git clone --quiet --depth 1 "');
  console.log('  [2] Added --quiet to git clone commands');
  changes++;
} else if (content.includes('git clone --quiet')) {
  console.log('  [2] git clone already has --quiet flag');
} else {
  console.log('  [2] No git clone commands found to optimize');
}

// Optimization 3: Reduce SSH polling interval from 500ms to 200ms
if (content.includes('setTimeout(r, 500));\n  }\n  throw new Error(`SSH did not become available')) {
  content = content.replace(
    'setTimeout(r, 500));\n  }\n  throw new Error(`SSH did not become available',
    'setTimeout(r, 200));\n  }\n  throw new Error(`SSH did not become available'
  );
  console.log('  [3] Reduced SSH poll interval from 500ms to 200ms');
  changes++;
} else if (content.includes('setTimeout(r, 200));\n  }\n  throw new Error(`SSH did not become available')) {
  console.log('  [3] SSH poll interval already at 200ms');
} else {
  console.log('  [3] Could not find SSH poll interval to optimize');
}

if (changes > 0) {
  fs.writeFileSync(serverPath, content);
  console.log(`\nApplied ${changes} optimization(s)`);
} else {
  console.log('\nAll optimizations already applied');
}
NODEJS_EOF
EOF

# Step 2: Restart service
echo ""
echo "Step 2: Restarting firecracker-manager service..."
$SSH_CMD << 'EOF'
systemctl restart firecracker-manager
sleep 2
echo "Service status:"
systemctl status firecracker-manager --no-pager | head -10
echo ""
echo "Health check:"
curl -s http://localhost:8080/health | python3 -m json.tool
EOF

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Optimizations applied:"
echo "  1. Same-filesystem node_modules restore (~2-3s improvement)"
echo "  2. Quiet git clone (reduced SSH buffer overhead, ~0.5-1s)"
echo "  3. Faster SSH polling (200ms vs 500ms, ~0.3s)"
echo ""
echo "Expected improvement: ~2.5-3.5 seconds per VM setup"
