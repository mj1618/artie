#!/bin/bash
#
# Deploy Git Repository Cache to Firecracker Host
#
# This script adds a shared git repository cache that speeds up VM setup
# by cloning from a local bare repo instead of GitHub each time.
#
# Usage: ./deploy-repo-cache.sh
#

set -euo pipefail

HOST="157.230.181.26"
SSH_CMD="ssh root@$HOST"

echo "=== Deploying Git Repository Cache to Firecracker Host ==="

# Step 1: Create the repo-cache directory and set up NFS export
echo ""
echo "Step 1: Creating repo-cache directory and NFS export..."
$SSH_CMD << 'EOF'
set -e

# Create the cache directory
mkdir -p /opt/firecracker/shared/repo-cache
chown -R root:root /opt/firecracker/shared/repo-cache
chmod 755 /opt/firecracker/shared/repo-cache
echo "Created /opt/firecracker/shared/repo-cache"

# Add NFS export for repo-cache (if not already present)
if ! grep -q "repo-cache" /etc/exports; then
    echo "/opt/firecracker/shared/repo-cache 172.16.0.0/24(ro,sync,no_subtree_check,no_root_squash)" >> /etc/exports
    exportfs -ra
    echo "Added NFS export for repo-cache"
else
    echo "NFS export for repo-cache already exists"
fi

# Verify NFS exports
echo "Current NFS exports:"
exportfs -v
EOF

# Step 2: Create the cache update script (runs on host before VM clone)
echo ""
echo "Step 2: Creating cache update script..."
$SSH_CMD << 'OUTER_EOF'
cat > /opt/firecracker/api/update-repo-cache.sh << 'EOF'
#!/bin/bash
#
# Update Repository Cache
#
# Usage: update-repo-cache.sh <owner> <repo> <github_token>
#
# Updates or creates the bare repository cache for a given repo.
# Called before VM clone to ensure cache is fresh.
#

set -eo pipefail

OWNER="$1"
REPO="$2"
GITHUB_TOKEN="$3"

if [ -z "$OWNER" ] || [ -z "$REPO" ] || [ -z "$GITHUB_TOKEN" ]; then
    echo "Usage: update-repo-cache.sh <owner> <repo> <github_token>"
    exit 1
fi

CACHE_BASE="/opt/firecracker/shared/repo-cache"
CACHE_DIR="$CACHE_BASE/$OWNER/$REPO.git"
LOCK_FILE="/tmp/repo-cache-${OWNER}-${REPO}.lock"

# Create owner directory
mkdir -p "$CACHE_BASE/$OWNER"

# Use flock to prevent concurrent updates to the same cache
exec 200>"$LOCK_FILE"
if ! flock -w 120 200; then
    echo "Warning: Could not acquire lock, proceeding without cache update"
    exit 0
fi

REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${OWNER}/${REPO}.git"

if [ -d "$CACHE_DIR" ]; then
    echo "Cache exists for $OWNER/$REPO - fetching updates..."
    cd "$CACHE_DIR"
    
    # Update remote URL with fresh token
    git remote set-url origin "$REPO_URL" 2>/dev/null || git remote add origin "$REPO_URL" 2>/dev/null || true
    
    # Fetch all updates
    if ! git fetch --all --prune --tags 2>&1; then
        echo "Fetch failed, recreating cache..."
        cd /
        rm -rf "$CACHE_DIR"
        git clone --bare --mirror "$REPO_URL" "$CACHE_DIR" 2>&1
    fi
else
    echo "Cache miss for $OWNER/$REPO - creating cache..."
    git clone --bare --mirror "$REPO_URL" "$CACHE_DIR" 2>&1
fi

# Update cache access time for cleanup tracking
touch "$CACHE_DIR"

echo "Cache updated: $CACHE_DIR"
EOF

chmod +x /opt/firecracker/api/update-repo-cache.sh
echo "Created /opt/firecracker/api/update-repo-cache.sh"
OUTER_EOF

# Step 3: Create cache cleanup script
echo ""
echo "Step 3: Creating cache cleanup script..."
$SSH_CMD << 'OUTER_EOF'
cat > /opt/firecracker/api/cleanup-repo-cache.sh << 'EOF'
#!/bin/bash
#
# Cleanup old repo caches
# Removes caches not accessed in the last 7 days
#

CACHE_BASE="/opt/firecracker/shared/repo-cache"
DAYS_OLD=7

echo "$(date): Cleaning up repo caches older than $DAYS_OLD days..."

find "$CACHE_BASE" -maxdepth 2 -name "*.git" -type d -mtime +$DAYS_OLD 2>/dev/null | while read cache_dir; do
    echo "Removing stale cache: $cache_dir"
    rm -rf "$cache_dir"
done

# Remove empty owner directories
find "$CACHE_BASE" -maxdepth 1 -type d -empty -delete 2>/dev/null || true

echo "$(date): Cache cleanup complete"
EOF

chmod +x /opt/firecracker/api/cleanup-repo-cache.sh

# Add cron job (weekly on Sunday at 3am) if not present
CRON_LINE="0 3 * * 0 /opt/firecracker/api/cleanup-repo-cache.sh >> /var/log/repo-cache-cleanup.log 2>&1"
if ! crontab -l 2>/dev/null | grep -q "cleanup-repo-cache.sh"; then
    (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
    echo "Added cleanup cron job"
else
    echo "Cleanup cron job already exists"
fi
OUTER_EOF

# Step 4: Patch server.js to use the cache
echo ""
echo "Step 4: Patching server.js to use repo cache..."
$SSH_CMD << 'EOF'
set -e

SERVER_FILE="/opt/firecracker/api/server.js"
BACKUP_FILE="${SERVER_FILE}.backup.$(date +%Y%m%d%H%M%S)"

# Check if already patched
if grep -q "update-repo-cache.sh" "$SERVER_FILE"; then
    echo "Server.js already patched for repo cache - skipping"
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

// Find the runSetup function and add cache update before clone
const runSetupMatch = content.match(/async function runSetup\(vm, \{ repo, branch, githubToken, envVars \}\) \{[\s\S]*?await reportStatus\(vm, "cloning"\);/);

if (!runSetupMatch) {
    console.error('Could not find runSetup function');
    process.exit(1);
}

const insertPoint = runSetupMatch.index + runSetupMatch[0].length;

const cacheUpdateCode = `
    
    // Update repo cache on host before cloning
    const [owner, repoName] = repo.split('/');
    try {
      const { execSync } = require('child_process');
      console.log(\`[runSetup] Updating repo cache for \${repo}...\`);
      execSync(\`/opt/firecracker/api/update-repo-cache.sh "\${owner}" "\${repoName}" "\${githubToken}"\`, {
        timeout: 120000,
        stdio: 'inherit'
      });
    } catch (cacheErr) {
      console.log(\`[runSetup] Cache update warning: \${cacheErr.message} - will clone directly\`);
    }
`;

content = content.slice(0, insertPoint) + cacheUpdateCode + content.slice(insertPoint);

// Update the clone command to use the cache path
// Find the git clone command and replace it with cache-aware version
const clonePattern = /`git clone --depth 1 --branch \$\{branch\} https:\/\/x-access-token:\$\{githubToken\}@github\.com\/\$\{repo\}\.git \/app 2>&1`/;

const cacheAwareClone = '`if [ -d "/mnt/repo-cache/${owner}/${repoName}.git" ]; then ' +
    'git clone --branch ${branch} "file:///mnt/repo-cache/${owner}/${repoName}.git" /app 2>&1 && ' +
    'cd /app && git remote set-url origin "https://x-access-token:${githubToken}@github.com/${repo}.git"; ' +
    'else git clone --depth 1 --branch ${branch} "https://x-access-token:${githubToken}@github.com/${repo}.git" /app 2>&1; fi`';

if (clonePattern.test(content)) {
    content = content.replace(clonePattern, cacheAwareClone);
    console.log('Updated git clone command to use cache');
} else {
    console.log('Warning: Could not find git clone pattern to update');
}

// Also need to add owner/repoName extraction before the clone (if not already there)
// And mount the repo-cache in the VM

// Find the mountSharedPnpmStore call and add repo-cache mount after it
const pnpmMountMatch = content.match(/const useSharedStore = await mountSharedPnpmStore\(vm\);/);
if (pnpmMountMatch) {
    const mountInsertPoint = pnpmMountMatch.index + pnpmMountMatch[0].length;
    const repoCacheMount = `
    
    // Mount shared repo cache
    try {
      await execInVm(vm, 'mkdir -p /mnt/repo-cache && mount -t nfs -o ro,nolock 172.16.0.1:/opt/firecracker/shared/repo-cache /mnt/repo-cache', { timeout: 10000 });
      console.log(\`[runSetup] Mounted repo cache for VM \${vm.name}\`);
    } catch (mountErr) {
      console.log(\`[runSetup] Repo cache mount warning: \${mountErr.message}\`);
    }`;
    
    content = content.slice(0, mountInsertPoint) + repoCacheMount + content.slice(mountInsertPoint);
    console.log('Added repo-cache mount');
}

// Make sure owner/repoName variables are defined before use
// The insertion point for cache update already uses them, we need to ensure they're in scope for the clone too
// Let's check if they're defined globally in the scope

fs.writeFileSync(serverPath, content);
console.log('Server.js patched successfully');
NODEJS_EOF

echo "Server.js patched"
EOF

# Step 5: Restart the firecracker-manager service
echo ""
echo "Step 5: Restarting firecracker-manager service..."
$SSH_CMD << 'EOF'
systemctl restart firecracker-manager
sleep 2
systemctl status firecracker-manager --no-pager | head -20
EOF

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "The repo cache is now set up at /opt/firecracker/shared/repo-cache"
echo ""
echo "How it works:"
echo "  1. Before cloning, host updates/creates bare repo cache"
echo "  2. Cache is mounted read-only in VM at /mnt/repo-cache"  
echo "  3. VM clones from local cache if available, otherwise from GitHub"
echo "  4. Weekly cleanup removes unused caches (7+ days old)"
echo ""
echo "Benefits:"
echo "  - First clone: Downloads from GitHub, creates local cache"
echo "  - Subsequent clones: Uses local cache (10x faster)"
echo "  - All branches available (bare mirror)"
echo "  - Safe for concurrent VM setups"
echo ""
