#!/bin/bash
#
# Deploy/Verify Shared pnpm Cache on Firecracker Host
#
# This script ensures the shared pnpm store via NFS is properly configured.
# When a package is installed in one VM, it becomes immediately available 
# to all other VMs.
#
# Usage: ./deploy-pnpm-cache.sh
#

set -euo pipefail

HOST="157.230.181.26"
SSH_CMD="ssh root@$HOST"

echo "=== Deploying/Verifying Shared pnpm Cache on Firecracker Host ==="

# Step 1: Ensure pnpm-store directory and NFS export exist
echo ""
echo "Step 1: Checking pnpm-store directory and NFS export..."
$SSH_CMD << 'EOF'
set -e

# Create the cache directory if needed
if [ ! -d /opt/firecracker/shared/pnpm-store ]; then
    mkdir -p /opt/firecracker/shared/pnpm-store
    echo "Created /opt/firecracker/shared/pnpm-store"
else
    echo "/opt/firecracker/shared/pnpm-store already exists"
fi

chown -R root:root /opt/firecracker/shared/pnpm-store
chmod 777 /opt/firecracker/shared/pnpm-store

# Add NFS export for pnpm-store (if not already present)
if ! grep -q "pnpm-store" /etc/exports; then
    echo "/opt/firecracker/shared/pnpm-store 172.16.0.0/24(rw,sync,no_subtree_check,no_root_squash)" >> /etc/exports
    exportfs -ra
    echo "Added NFS export for pnpm-store"
else
    echo "NFS export for pnpm-store already exists"
fi

# Ensure NFS server is running
systemctl enable nfs-kernel-server 2>/dev/null || true
systemctl start nfs-kernel-server 2>/dev/null || true

echo "NFS exports:"
exportfs -v | grep pnpm-store || echo "(pnpm-store export not found)"
EOF

# Step 2: Check firewall
echo ""
echo "Step 2: Checking firewall rules for VM network..."
$SSH_CMD << 'EOF'
if ! ufw status | grep -q "172.16.0.0/24"; then
    echo "Adding firewall rule for VM network..."
    ufw allow from 172.16.0.0/24 comment "Allow all from VMs to host (NFS)"
else
    echo "Firewall rule for VM network exists"
fi
EOF

# Step 3: Verify configurePnpmStore is called in server.js
echo ""
echo "Step 3: Verifying pnpm store configuration in server.js..."
$SSH_CMD << 'EOF'
set -e

SERVER_FILE="/opt/firecracker/api/server.js"

# Check if configurePnpmStore function exists
if ! grep -q "async function configurePnpmStore" "$SERVER_FILE"; then
    echo "ERROR: configurePnpmStore function not found in server.js"
    echo "The server.js may need to be rebuilt"
    exit 1
fi

# Check if configurePnpmStore is being called
if grep -q "await configurePnpmStore(vm" "$SERVER_FILE"; then
    echo "✓ configurePnpmStore is being called"
else
    echo "WARNING: configurePnpmStore exists but is not being called"
    echo "Patching server.js..."
    
    BACKUP_FILE="${SERVER_FILE}.backup.$(date +%Y%m%d%H%M%S)"
    cp "$SERVER_FILE" "$BACKUP_FILE"
    
    node << 'NODEJS_EOF'
const fs = require('fs');
const serverPath = '/opt/firecracker/api/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find where useSharedStore is logged and add configurePnpmStore call after
const pattern = /console\.log\(`\[runSetup\] Using \$\{pkgManager\} for \$\{vm\.name\}, shared store: \$\{useSharedStore\}`\);/;
const match = content.match(pattern);

if (!match) {
    console.error('Could not find the useSharedStore log pattern');
    process.exit(1);
}

const insertPoint = match.index + match[0].length;
const configureCall = `

    // Configure pnpm to use shared store if mounted (important: must happen before pnpm install)
    if (pkgManager === "pnpm" && useSharedStore) {
      await configurePnpmStore(vm, true);
      if (vmId) appendLog(vmId, "Configured pnpm shared cache");
    }
`;

content = content.slice(0, insertPoint) + configureCall + content.slice(insertPoint);
fs.writeFileSync(serverPath, content);
console.log('Patched server.js with configurePnpmStore call');
NODEJS_EOF

    systemctl restart firecracker-manager
    sleep 2
    echo "Service restarted"
fi

# Check mount happens in setup
if grep -q "/mnt/pnpm-store" "$SERVER_FILE"; then
    echo "✓ pnpm-store mount path is configured"
else
    echo "WARNING: /mnt/pnpm-store not found in server.js"
fi
EOF

# Step 4: Show service status
echo ""
echo "Step 4: Service status..."
$SSH_CMD "systemctl status firecracker-manager --no-pager | head -10"

echo ""
echo "=== Verification Complete ==="
echo ""
echo "The shared pnpm cache is set up at /opt/firecracker/shared/pnpm-store"
echo ""
echo "How it works:"
echo "  1. VMs mount /mnt/pnpm-store from host via NFS during setup"
echo "  2. configurePnpmStore() sets pnpm store-dir to /mnt/pnpm-store"
echo "  3. pnpm install uses the shared store for all packages"
echo ""
echo "To verify on a running VM:"
echo "  ssh root@<vm-ip>"
echo "  df -h /mnt/pnpm-store        # Check NFS mount"
echo "  pnpm config get store-dir    # Should show /mnt/pnpm-store"
echo ""
