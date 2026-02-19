#!/bin/bash
#
# Deploy pnpm --package-import-method copy to Firecracker Host
#
# This script updates pnpm install commands to use --package-import-method copy,
# which copies packages instead of using symlinks. This is more reliable in
# VM environments where symlinks to the shared store may have issues.
#
# Usage: ./deploy-pnpm-copy-method.sh
#

set -euo pipefail

HOST="157.230.181.26"
SSH_CMD="ssh root@$HOST"

echo "=== Deploying pnpm --package-import-method copy to Firecracker Host ==="

# Step 1: Backup server.js
echo ""
echo "Step 1: Backing up server.js..."
$SSH_CMD "cp /opt/firecracker/api/server.js /opt/firecracker/api/server.js.backup.\$(date +%Y%m%d%H%M%S)"

# Step 2: Check if already patched
echo ""
echo "Step 2: Checking current state..."
if $SSH_CMD "grep -q 'package-import-method copy' /opt/firecracker/api/server.js"; then
    echo "Already patched with --package-import-method copy"
    exit 0
fi

# Step 3: Patch the pnpm install commands
echo ""
echo "Step 3: Patching pnpm install commands..."
$SSH_CMD << 'EOF'
node << 'NODEJS'
const fs = require('fs');

const serverPath = '/opt/firecracker/api/server.js';
let content = fs.readFileSync(serverPath, 'utf8');
let changes = 0;

// Pattern 1: pnpm install --frozen-lockfile
const frozenPattern = /pnpm install --frozen-lockfile/g;
if (frozenPattern.test(content)) {
    content = content.replace(frozenPattern, 'pnpm install --package-import-method copy --frozen-lockfile');
    changes++;
    console.log('Updated: pnpm install --frozen-lockfile');
}

// Pattern 2: pnpm install --offline (may appear multiple times)
const offlinePattern = /pnpm install --offline/g;
const offlineMatches = content.match(offlinePattern);
if (offlineMatches) {
    content = content.replace(offlinePattern, 'pnpm install --package-import-method copy --offline');
    changes += offlineMatches.length;
    console.log(`Updated: pnpm install --offline (${offlineMatches.length} occurrences)`);
}

// Pattern 3: Bare pnpm install (without flags, at word boundary)
// Be careful not to match already-patched ones
// Match "pnpm install" followed by either end of string, quote, or non-flag char
const barePattern = /pnpm install(?![\w-]| --package-import-method)/g;
const bareMatches = content.match(barePattern);
if (bareMatches) {
    content = content.replace(barePattern, 'pnpm install --package-import-method copy');
    changes += bareMatches.length;
    console.log(`Updated: bare pnpm install (${bareMatches.length} occurrences)`);
}

if (changes > 0) {
    fs.writeFileSync(serverPath, content);
    console.log(`\nTotal: ${changes} pnpm install commands updated`);
} else {
    console.log('No pnpm install commands found to update');
}
NODEJS
EOF

# Step 4: Verify the changes
echo ""
echo "Step 4: Verifying changes..."
$SSH_CMD "grep -n 'pnpm install' /opt/firecracker/api/server.js | head -15"

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
echo "All pnpm install commands now use --package-import-method copy"
echo "This copies packages instead of symlinking from the shared store."
echo ""
