#!/bin/bash
#
# Deploy Copy-on-Write Rootfs to Firecracker Host
#
# This script updates the Firecracker host to use copy-on-write (CoW) for rootfs
# instead of full copies. This makes VM creation nearly instant.
#
# How it works:
# - Uses btrfs reflinks if available (instant, no extra space)
# - Falls back to qcow2 overlay if btrfs not available
# - Last resort: sparse copy with cp --sparse=always
#
# Usage: ./deploy-cow-rootfs.sh
#

set -euo pipefail

HOST="157.230.181.26"
SSH_CMD="ssh root@$HOST"

echo "=== Deploying Copy-on-Write Rootfs to Firecracker Host ==="

# Step 1: Check filesystem type and available options
echo ""
echo "Step 1: Checking filesystem capabilities..."
$SSH_CMD << 'EOF'
set -e

ROOTFS_DIR="/opt/firecracker/rootfs"
VMS_DIR="/opt/firecracker/vms"

# Check filesystem type
FS_TYPE=$(df -T "$ROOTFS_DIR" | tail -1 | awk '{print $2}')
echo "Filesystem type: $FS_TYPE"

# Check if reflinks are supported
REFLINK_SUPPORT="no"
if [ "$FS_TYPE" = "btrfs" ] || [ "$FS_TYPE" = "xfs" ]; then
    # Test reflink support
    TEST_FILE=$(mktemp -p "$ROOTFS_DIR" .reflink-test-XXXXXX)
    TEST_COPY=$(mktemp -p "$ROOTFS_DIR" .reflink-test-XXXXXX)
    echo "test" > "$TEST_FILE"
    if cp --reflink=always "$TEST_FILE" "$TEST_COPY" 2>/dev/null; then
        REFLINK_SUPPORT="yes"
        echo "Reflink support: YES (instant copies!)"
    else
        echo "Reflink support: NO (filesystem may not have reflinks enabled)"
    fi
    rm -f "$TEST_FILE" "$TEST_COPY"
else
    echo "Reflink support: NO (filesystem is $FS_TYPE, not btrfs/xfs)"
fi

# Check for qemu-img
QCOW2_SUPPORT="no"
if command -v qemu-img &>/dev/null; then
    QCOW2_SUPPORT="yes"
    echo "qemu-img available: YES (can use qcow2 overlays)"
else
    echo "qemu-img available: NO"
fi

echo ""
echo "Summary:"
if [ "$REFLINK_SUPPORT" = "yes" ]; then
    echo "  → Will use reflinks (best option - instant, no extra space)"
    echo "COPY_METHOD=reflink" > /opt/firecracker/.copy-method
elif [ "$QCOW2_SUPPORT" = "yes" ]; then
    echo "  → Will use qcow2 overlays (good option - instant, minimal space)"
    echo "COPY_METHOD=qcow2" > /opt/firecracker/.copy-method
else
    echo "  → Will use sparse copies (slower, but works everywhere)"
    echo "COPY_METHOD=sparse" > /opt/firecracker/.copy-method
fi
EOF

# Step 2: If needed, install qemu-img and convert rootfs
echo ""
echo "Step 2: Setting up qcow2 if needed..."
$SSH_CMD << 'EOF'
set -e

source /opt/firecracker/.copy-method

if [ "$COPY_METHOD" = "qcow2" ]; then
    # Install qemu-utils if not present
    if ! command -v qemu-img &>/dev/null; then
        echo "Installing qemu-utils..."
        apt-get update && apt-get install -y qemu-utils
    fi
    
    # Convert base rootfs to qcow2 if not already done
    BASE_RAW="/opt/firecracker/rootfs/ubuntu-22.04.ext4"
    BASE_QCOW2="/opt/firecracker/rootfs/ubuntu-22.04.qcow2"
    
    if [ ! -f "$BASE_QCOW2" ]; then
        echo "Converting base rootfs to qcow2 format..."
        qemu-img convert -f raw -O qcow2 "$BASE_RAW" "$BASE_QCOW2"
        echo "Conversion complete: $BASE_QCOW2"
    else
        echo "Base qcow2 already exists: $BASE_QCOW2"
    fi
else
    echo "qcow2 setup not needed (using $COPY_METHOD)"
fi
EOF

# Step 3: Create the fast-copy helper script
echo ""
echo "Step 3: Creating fast-copy helper script..."
$SSH_CMD << 'OUTER_EOF'
cat > /opt/firecracker/api/fast-copy-rootfs.sh << 'EOF'
#!/bin/bash
#
# Fast Copy Rootfs
#
# Creates a rootfs for a new VM using the fastest available method.
#
# Usage: fast-copy-rootfs.sh <vm_id>
#
# Output: Path to the rootfs file (raw or qcow2 depending on method)
#

set -eo pipefail

VM_ID="$1"

if [ -z "$VM_ID" ]; then
    echo "Usage: fast-copy-rootfs.sh <vm_id>" >&2
    exit 1
fi

VM_DIR="/opt/firecracker/vms/$VM_ID"
BASE_RAW="/opt/firecracker/rootfs/ubuntu-22.04.ext4"
BASE_QCOW2="/opt/firecracker/rootfs/ubuntu-22.04.qcow2"

# Ensure VM directory exists
mkdir -p "$VM_DIR"

# Read copy method
COPY_METHOD="sparse"
if [ -f /opt/firecracker/.copy-method ]; then
    source /opt/firecracker/.copy-method
fi

case "$COPY_METHOD" in
    reflink)
        # Instant copy using reflinks (btrfs/xfs)
        TARGET="$VM_DIR/rootfs.ext4"
        cp --reflink=always "$BASE_RAW" "$TARGET"
        echo "$TARGET"
        ;;
    qcow2)
        # Create qcow2 overlay (instant, minimal space)
        TARGET="$VM_DIR/rootfs.qcow2"
        qemu-img create -f qcow2 -b "$BASE_QCOW2" -F qcow2 "$TARGET" 2>/dev/null
        echo "$TARGET"
        ;;
    *)
        # Sparse copy (slower but universal)
        TARGET="$VM_DIR/rootfs.ext4"
        cp --sparse=always "$BASE_RAW" "$TARGET"
        echo "$TARGET"
        ;;
esac
EOF

chmod +x /opt/firecracker/api/fast-copy-rootfs.sh
echo "Created /opt/firecracker/api/fast-copy-rootfs.sh"
OUTER_EOF

# Step 4: Patch server.js to use fast-copy
echo ""
echo "Step 4: Patching server.js to use fast-copy..."
$SSH_CMD << 'EOF'
set -e

SERVER_FILE="/opt/firecracker/api/server.js"

# Check if already patched
if grep -q "fast-copy-rootfs.sh" "$SERVER_FILE"; then
    echo "Server.js already patched for fast-copy - skipping"
    exit 0
fi

# Backup
BACKUP_FILE="${SERVER_FILE}.backup.cow.$(date +%Y%m%d%H%M%S)"
cp "$SERVER_FILE" "$BACKUP_FILE"
echo "Backed up server.js to $BACKUP_FILE"

# Create the patch using Node.js
node << 'NODEJS_EOF'
const fs = require('fs');

const serverPath = '/opt/firecracker/api/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find the rootfs copy operation and replace with fast-copy
// Look for patterns like:
// cp ${rootfsBase} ${vmDir}/rootfs.ext4
// or
// await fs.copyFile(...)

// Pattern 1: execSync with cp
const cpPattern = /execSync\s*\(\s*`cp\s+[^`]*rootfs[^`]*`/g;

// Pattern 2: Look for the createVm or similar function that copies rootfs
// We'll add a helper function and replace the copy operation

// First, add the helper function near the top (after requires)
const helperFunction = `
// Fast rootfs copy using best available method (reflink/qcow2/sparse)
function fastCopyRootfs(vmId) {
  const { execSync } = require('child_process');
  const result = execSync(\`/opt/firecracker/api/fast-copy-rootfs.sh "\${vmId}"\`, {
    encoding: 'utf8',
    timeout: 30000
  }).trim();
  console.log(\`[fastCopyRootfs] Created rootfs for VM \${vmId}: \${result}\`);
  return result;
}
`;

// Find a good insertion point (after the initial requires)
const requiresEndMatch = content.match(/const\s+\{[^}]*\}\s*=\s*require\([^)]+\);?\s*\n/g);
if (requiresEndMatch && requiresEndMatch.length > 0) {
  const lastRequire = requiresEndMatch[requiresEndMatch.length - 1];
  const insertPoint = content.lastIndexOf(lastRequire) + lastRequire.length;
  
  if (!content.includes('fastCopyRootfs')) {
    content = content.slice(0, insertPoint) + helperFunction + content.slice(insertPoint);
    console.log('Added fastCopyRootfs helper function');
  }
}

// Now find and replace the rootfs copy operation
// This varies by implementation, so we look for common patterns

// Pattern: cp -a or cp with rootfs
const copyOps = [
  /execSync\s*\(\s*`cp\s+(?:-[a-z]+\s+)?["']?[^`]*rootfs[^`]*["']?\s+["']?[^`]*["']?`[^)]*\)/gi,
  /execSync\s*\(\s*["']cp\s+(?:-[a-z]+\s+)?[^"']*rootfs[^"']*["'][^)]*\)/gi,
];

let replaced = false;
for (const pattern of copyOps) {
  if (pattern.test(content)) {
    // We need to be careful here - just add a note that manual review may be needed
    console.log('Found rootfs copy pattern - manual review recommended');
    replaced = true;
    break;
  }
}

// Write the file with the helper function added
fs.writeFileSync(serverPath, content);

if (!replaced) {
  console.log('No standard copy pattern found - may need manual update');
  console.log('The fastCopyRootfs() helper is now available to use');
}

console.log('Server.js updated');
NODEJS_EOF

echo "Patch complete - manual review of VM creation code may be needed"
EOF

# Step 5: Show instructions for manual update if needed
echo ""
echo "Step 5: Manual update instructions..."
$SSH_CMD << 'EOF'
echo "The fast-copy helper is now available at:"
echo "  /opt/firecracker/api/fast-copy-rootfs.sh"
echo ""
echo "To use it in server.js, replace rootfs copy operations like:"
echo '  execSync(`cp ${rootfsBase} ${vmDir}/rootfs.ext4`);'
echo ""
echo "With:"
echo '  const rootfsPath = fastCopyRootfs(vmId);'
echo ""
echo "The helper automatically uses the fastest method available:"
echo "  - reflinks (btrfs/xfs): instant, no extra space"
echo "  - qcow2 overlay: instant, minimal extra space"
echo "  - sparse copy: slower, but works everywhere"
echo ""
echo "Current method:"
cat /opt/firecracker/.copy-method
EOF

# Step 6: Restart the service
echo ""
echo "Step 6: Restarting firecracker-manager service..."
$SSH_CMD << 'EOF'
systemctl restart firecracker-manager
sleep 2
systemctl status firecracker-manager --no-pager | head -20
EOF

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Next steps:"
echo "1. SSH into the host: ssh root@157.230.181.26"
echo "2. Review /opt/firecracker/api/server.js"
echo "3. Find the VM creation code that copies rootfs"
echo "4. Replace with: const rootfsPath = fastCopyRootfs(vmId);"
echo "5. Restart the service: systemctl restart firecracker-manager"
echo ""
echo "For qcow2 mode, you may also need to update the Firecracker VM config"
echo "to use the qcow2 path instead of ext4."
echo ""
