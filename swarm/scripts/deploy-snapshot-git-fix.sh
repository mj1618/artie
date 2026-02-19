#!/bin/bash
#
# Fix Git Setup for Snapshot Restores
#
# This script fixes a bug where restoring from a snapshot fails because:
# 1. /app already exists from the snapshot
# 2. git fetch fails for some reason
# 3. Fallback to "full clone" fails because /app exists
#
# The fix: When /app already exists (from snapshot), the git update logic
# should clear /app before attempting a fresh clone fallback.
#
# Usage: ./deploy-snapshot-git-fix.sh
#

set -euo pipefail

HOST="157.230.181.26"
SSH_CMD="ssh root@$HOST"

echo "=== Deploying Snapshot Git Fix ==="

# Step 1: Backup server.js
echo ""
echo "Step 1: Backing up server.js..."
$SSH_CMD "cp /opt/firecracker/api/server.js /opt/firecracker/api/server.js.backup.\$(date +%Y%m%d%H%M%S)"

# Step 2: Check what the current git update logic looks like
echo ""
echo "Step 2: Checking current git update logic..."
$SSH_CMD << 'EOF'
echo "=== Current git fetch/clone logic ==="
grep -n "Fetching latest\|git fetch\|doing full clone\|git clone\|/app.*already exists" /opt/firecracker/api/server.js | head -40 || echo "(pattern not found)"
EOF

# Step 3: Apply the fix
echo ""
echo "Step 3: Applying fix..."
$SSH_CMD << 'EOF'
set -e

node << 'NODEJS_EOF'
const fs = require('fs');

const serverPath = '/opt/firecracker/api/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find the pattern where git fetch fails and it falls back to full clone
// The issue is that when restoring from snapshot, /app exists, so clone fails
// We need to add "rm -rf /app" before the fallback clone

// Look for the pattern: "Git setup failed, doing full clone"
// This is where the fallback happens

// Pattern 1: Find where the full clone fallback happens
// After "Git setup failed", there's typically a tar download or git clone
const gitSetupFailedPattern = /Git setup failed.*doing full clone/gi;
const hasGitSetupFailed = gitSetupFailedPattern.test(content);

if (!hasGitSetupFailed) {
    console.log('Could not find "Git setup failed, doing full clone" pattern');
    console.log('Searching for related patterns...');
    
    // Try to find the actual clone command that's failing
    const cloneToAppPattern = /git clone[^`]*\/app/g;
    const matches = content.match(cloneToAppPattern);
    console.log('Clone to /app patterns found:', matches ? matches.length : 0);
    if (matches) {
        matches.forEach((m, i) => console.log(`  ${i}: ${m.substring(0, 100)}...`));
    }
}

// The fix strategy:
// Before any git clone to /app that's in a fallback/retry context,
// add "rm -rf /app" to clear the directory

// Find the "full clone" section and add rm -rf /app before the tar/clone command
// Look for the pattern where it:
// 1. Logs about fetching latest code
// 2. Tries git fetch
// 3. On failure, does full clone

// Let's look for the actual tarball download + git clone pattern
const tarPattern = /tar\s+.*\/app/gi;
const tarMatches = content.match(tarPattern);
console.log('Tar to /app patterns found:', tarMatches ? tarMatches.length : 0);

// Find the setup/update logic for snapshot restore
// The pattern typically looks like:
// - Try git fetch origin
// - If fails, try full clone via tar or git clone

// Let's find and fix the full clone fallback
// Pattern: After "doing full clone", there's a command that clones to /app
// We need to insert "rm -rf /app" before that clone

// Search for the code block containing the fallback
const fullCloneBlockPattern = /(Git setup failed.*?doing full clone.*?)(curl.*?tar|git clone)([^;`]*)(\/app)/gi;

let fixed = false;
content = content.replace(fullCloneBlockPattern, (match, before, command, middle, app) => {
    console.log('Found full clone fallback pattern, adding rm -rf /app');
    // Insert rm -rf /app before the command
    // The pattern is typically in a shell command string, so we need to add it inline
    fixed = true;
    return before + 'rm -rf /app 2>/dev/null || true; ' + command + middle + app;
});

if (!fixed) {
    console.log('Could not find the full clone fallback pattern to fix automatically.');
    console.log('Will try alternative approach...');
    
    // Alternative: Find any shell command that clones to /app after a failure message
    // and wrap it with a conditional rm
    
    // Look for backtick command strings containing clone to /app
    const backTickClonePattern = /`[^`]*git clone[^`]*\/app[^`]*`/g;
    const btMatches = content.match(backTickClonePattern);
    console.log('Backtick clone patterns:', btMatches ? btMatches.length : 0);
    
    // Let's look for the exact runSetup function and understand its structure
    const runSetupStart = content.indexOf('async function runSetup');
    if (runSetupStart !== -1) {
        const runSetupEnd = content.indexOf('\nasync function', runSetupStart + 10);
        const runSetup = content.substring(runSetupStart, runSetupEnd > 0 ? runSetupEnd : runSetupStart + 3000);
        console.log('\n=== runSetup function preview (first 2000 chars) ===');
        console.log(runSetup.substring(0, 2000));
    }
}

fs.writeFileSync(serverPath, content);
console.log('\nServer.js updated (check if fix was applied above)');
NODEJS_EOF
EOF

# Step 4: Show what the current setup logic looks like
echo ""
echo "Step 4: Showing current setup logic around git fetch/clone..."
$SSH_CMD << 'EOF'
echo ""
echo "=== Looking for the full setup flow ==="
# Find lines around "Fetching latest" or "git fetch" or snapshot restore
grep -n -A 5 -B 2 "Fetching latest\|git fetch\|doing full clone\|restoredFrom" /opt/firecracker/api/server.js | head -80 || echo "(not found)"
EOF

# Step 5: Manual inspection and fix if needed
echo ""
echo "Step 5: Checking if automatic fix worked..."
$SSH_CMD << 'EOF'
if grep -q "rm -rf /app.*doing full clone\|rm -rf /app.*git clone" /opt/firecracker/api/server.js; then
    echo "✓ Fix appears to be applied"
else
    echo "✗ Automatic fix may not have worked"
    echo ""
    echo "Manual inspection needed. Here's the relevant code section:"
    echo ""
    # Show the actual code around any full clone logic
    grep -n -B 5 -A 10 "doing full clone\|/app.*already exists" /opt/firecracker/api/server.js | head -50
fi
EOF

echo ""
echo "=== Diagnostic Complete ==="
echo ""
echo "Next steps:"
echo "  1. SSH into the host: ssh root@$HOST"
echo "  2. Check /opt/firecracker/api/server.js for the git setup logic"
echo "  3. Find where 'doing full clone' happens and add 'rm -rf /app' before it"
echo "  4. Restart service: systemctl restart firecracker-manager"
echo ""
