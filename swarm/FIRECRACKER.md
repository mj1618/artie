# Firecracker Host for Artie

This document describes the Firecracker microVM host used to run project development environments.

## Overview

Instead of spinning up individual DigitalOcean droplets per project/session, we use a single powerful droplet running Firecracker to manage lightweight microVMs. Each microVM boots in under 1 second and uses minimal resources.

## VM Pool (Instant Provisioning)

To eliminate boot time latency, we maintain a pool of pre-warmed VMs that are already booted and waiting for assignment.

### How It Works

1. **Background Pool**: The system maintains 3 ready VMs at all times
2. **Instant Assignment**: When a user requests a VM, we assign a pooled VM instead of creating new
3. **Skip Boot Phase**: Pooled VMs go directly to "cloning" (setup), skipping "creating" and "booting"
4. **Auto-Replenish**: The pool automatically refills in the background

### User Experience

- **With Pool (normal)**: User sees "Cloning repository..." immediately (~0s boot)
- **Without Pool (fallback)**: User sees "Booting VM..." then "Cloning..." (~5-15s boot)

### Pool Configuration

Edit `convex/firecrackerPool.ts` to adjust:

```typescript
export const POOL_CONFIG = {
  targetSize: 3,     // Target number of ready VMs
  minSize: 1,        // Minimum before urgent replenishment
  maxCreating: 2,    // Max concurrent VM creations
  vmMemory: 2048,    // MB per VM (Next.js Turbopack needs ~800MB+)
  vmVcpus: 2,
  vmPorts: [3000],
};
```

### Monitoring Pool Status

Check pool status in Convex dashboard or via:

```bash
# On Convex dashboard, run this query:
# internal.firecrackerPool.getPoolStats
```

Returns: `{ ready: 3, creating: 0, failed: 0, targetSize: 3, minSize: 1 }`

## Host Details

| Property | Value |
|----------|-------|
| **Droplet ID** | 552295271 |
| **Name** | artie-firecracker-host |
| **Public IP** | 157.230.181.26 |
| **Specs** | 8 vCPUs, 16GB RAM, 320GB SSD |
| **Cost** | $96/month |
| **Region** | NYC1 |
| **OS** | Ubuntu 24.04 LTS |
| **Firecracker Version** | v1.14.1 |

## SSH Access

```bash
ssh root@157.230.181.26
```

## Management API

The Firecracker Manager API runs on port 8080 and manages microVM lifecycle.

### Authentication

All `/api/*` endpoints require Bearer token authentication:

```bash
Authorization: Bearer <API_SECRET>
```

**API Secret:** `23c17c1952fa688c07da3f738e1058d83624cad71c91e1ccf4172049f80cb5f5`

Store this in Convex environment variables as `FIRECRACKER_API_SECRET`.

### Endpoints

#### Health Check (no auth required)

```bash
curl http://157.230.181.26:8080/health
```

Response:
```json
{
  "status": "ok",
  "vmCount": 0,
  "uptime": 123.45
}
```

#### List All VMs

```bash
curl http://157.230.181.26:8080/api/vms \
  -H "Authorization: Bearer $API_SECRET"
```

#### Get VM Details

```bash
curl http://157.230.181.26:8080/api/vms/<vm_id> \
  -H "Authorization: Bearer $API_SECRET"
```

#### Create VM

```bash
curl -X POST http://157.230.181.26:8080/api/vms \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-project",
    "memory": 512,
    "vcpus": 1,
    "ports": [3000]
  }'
```

**Parameters:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Human-readable name for the VM |
| `memory` | number | 512 | Memory in MB |
| `vcpus` | number | 1 | Number of virtual CPUs |
| `ports` | number[] | [3000] | Guest ports to expose |

**Response:**
```json
{
  "id": "abc12345",
  "name": "my-project",
  "status": "running",
  "ip": "172.16.0.100",
  "ports": [
    { "guest": 3000, "host": 10000 }
  ]
}
```

#### Destroy VM

```bash
curl -X DELETE http://157.230.181.26:8080/api/vms/<vm_id> \
  -H "Authorization: Bearer $API_SECRET"
```

#### Terminal WebSocket

Connect via WebSocket for interactive shell access:

```
ws://157.230.181.26:8080/api/vms/<vm_id>/terminal?token=<API_SECRET_OR_CALLBACK_SECRET>
```

The token can be either:
- The host `API_SECRET` for admin access
- The VM's `callbackSecret` (set during setup) for per-VM access

The WebSocket proxies an SSH connection to the VM. Requires the VM to be in `ready` or `active` status.

**Deploying Terminal Support:**

```bash
./swarm/scripts/deploy-terminal.sh
```

This script:
1. Installs the `ws` npm package on the host
2. Adds the WebSocket terminal endpoint to `server.js`
3. Sets up SSH key injection for VM access
4. Stores the `callbackSecret` for per-VM authentication

## Port Mapping

Each VM gets ports mapped from the host:

- Guest port 3000 → Host port 10000 + (vm_index * 100)
- Guest port 3001 → Host port 10001 + (vm_index * 100)
- etc.

To access a VM's dev server externally:
```
http://157.230.181.26:<host_port>
```

## Capacity Planning

With 16GB RAM on the host (default 2GB per VM):

| VM Memory | Max VMs |
|-----------|---------|
| 512 MB | ~30 |
| 1 GB | ~15 |
| 2 GB (default) | ~7 |

Leave some headroom for the host OS (~1-2GB). Note: 2GB is the minimum recommended for Next.js apps with Turbopack - 1GB VMs get OOM killed during compilation.

## Shared Git Repository Cache

All VMs share a local bare repository cache to speed up git clones. When a repository is cloned for the first VM, subsequent VMs clone from the local cache instead of GitHub.

### How It Works

1. **First VM**: Clones from GitHub to `/opt/firecracker/shared/repo-cache/{owner}/{repo}.git` (bare repo)
2. **Subsequent VMs**: Clone from the local bare repo (10x faster than network)
3. **Automatic Updates**: Cache is updated with `git fetch` before each clone

### Benefits

- **Faster clones**: Local disk is ~10x faster than network clone
- **Reduced network**: Repository only downloads once, not per VM
- **Branch flexibility**: Bare repo caches all branches
- **Safe concurrency**: Lock file prevents race conditions

### Cache Location

```
/opt/firecracker/shared/repo-cache/
├── owner1/
│   ├── repo-a.git/        # Bare repo cache
│   └── repo-b.git/
└── owner2/
    └── repo-c.git/
```

### Using the Cache

The cache helper script at `/opt/firecracker/api/repo-cache.sh` handles all caching logic:

```bash
# Usage: repo-cache.sh <owner> <repo> <branch> <github_token> <target_dir>
/opt/firecracker/api/repo-cache.sh "myorg" "myrepo" "main" "$GITHUB_TOKEN" "/app"
```

### Cache Maintenance

- **Automatic cleanup**: A weekly cron job removes caches not accessed in 7+ days
- **Manual cleanup**: `rm -rf /opt/firecracker/shared/repo-cache/{owner}/{repo}.git`
- **Force refresh**: Delete the cache directory and it will re-clone from GitHub

### Deploying the Cache

Run the deployment script from your local machine:

```bash
./swarm/scripts/deploy-repo-cache.sh
```

This script:
1. Creates the cache directory structure
2. Installs the `repo-cache.sh` helper script
3. Sets up the weekly cleanup cron job

## Shared pnpm Cache

All VMs share a common pnpm store via NFS to dramatically speed up dependency installation. When a package is installed in one VM, it becomes immediately available to all other VMs.

### How It Works

1. **NFS Server on Host**: The host runs an NFS server exporting `/opt/firecracker/shared/pnpm-store`
2. **VMs Mount the Share**: Each VM mounts this directory at `/mnt/pnpm-store` via NFS
3. **pnpm Configuration**: pnpm is configured to use `/mnt/pnpm-store` as its store directory

### Benefits

- **Faster installs**: After the first install of any package, subsequent VMs can hard-link from the shared store
- **Reduced disk usage**: Packages are stored once on the host, not duplicated per VM
- **Reduced network**: Packages only download once, not per VM

### Verifying the Shared Cache

To check if a VM is using the shared cache:

```bash
# SSH into the host and then into a VM
ssh root@157.230.181.26
ssh root@172.16.0.100  # VM IP

# Check if NFS is mounted
df -h /mnt/pnpm-store

# Check pnpm store location
pnpm config get store-dir
```

### Troubleshooting Shared Cache

If the shared cache isn't working:

```bash
# On the host - check NFS server is running
systemctl status nfs-kernel-server
exportfs -v

# Check firewall allows VM network traffic (MOST COMMON ISSUE)
ufw status | grep 172.16
# Should show: Anywhere ALLOW 172.16.0.0/24

# If missing, add the rule:
ufw allow from 172.16.0.0/24 comment "Allow all from VMs to host"

# On a VM - try mounting manually
mount -t nfs -o nolock 172.16.0.1:/opt/firecracker/shared/pnpm-store /mnt/pnpm-store

# Check pnpm store contents
ls -la /mnt/pnpm-store/
```

If mount hangs or times out, it's usually a firewall issue. NFS requires multiple ports (2049 for nfs, plus dynamic ports for mountd/statd), so the simplest fix is to allow all traffic from the VM network.

## Copy-on-Write Rootfs

To speed up VM creation, the host can use copy-on-write (CoW) for rootfs images instead of full copies.

### Deploy CoW Support

```bash
./swarm/scripts/deploy-cow-rootfs.sh
```

This script:
1. Detects the best CoW method available (btrfs reflinks, qcow2, or sparse)
2. Sets up the necessary infrastructure
3. Creates a helper script at `/opt/firecracker/api/fast-copy-rootfs.sh`

### Methods (in order of preference)

| Method | Speed | Space | Requirements |
|--------|-------|-------|--------------|
| btrfs reflinks | Instant | 0 extra | btrfs or xfs with reflinks |
| qcow2 overlay | Instant | ~0 extra | qemu-img installed |
| sparse copy | 1-5s | Full size | Any filesystem |

### Manual Update

After running the deploy script, update `server.js` VM creation code:

```javascript
// Replace:
execSync(`cp ${rootfsBase} ${vmDir}/rootfs.ext4`);

// With:
const rootfsPath = fastCopyRootfs(vmId);
```

## Directory Structure on Host

```
/opt/firecracker/
├── api/                    # Management API
│   ├── server.js
│   ├── package.json
│   ├── repo-cache.sh      # Git repository cache helper
│   ├── fast-copy-rootfs.sh # CoW rootfs helper
│   └── cleanup-repo-cache.sh  # Cache cleanup script
├── kernels/
│   └── vmlinux            # Linux kernel for VMs
├── rootfs/
│   ├── ubuntu-22.04.ext4  # Base rootfs image (raw)
│   ├── ubuntu-22.04.qcow2 # Base rootfs image (qcow2, if using overlays)
│   └── rootfs.ext4        # Symlink to default
├── shared/                 # Shared resources across VMs
│   ├── pnpm-store/        # Shared pnpm package cache (NFS exported)
│   └── repo-cache/        # Shared git repository cache
│       └── <owner>/
│           └── <repo>.git # Bare repository
├── vms/                   # Running VM data
│   └── <vm_id>/
│       ├── config.json
│       ├── rootfs.ext4    # Copy for this VM (or rootfs.qcow2)
│       └── firecracker.sock
├── .env                   # API_SECRET
├── .copy-method           # CoW method config
└── setup-tap.sh           # TAP device helper
```

## Systemd Service

The API runs as a systemd service:

```bash
# Check status
systemctl status firecracker-manager

# View logs
journalctl -u firecracker-manager -f

# Restart
systemctl restart firecracker-manager
```

## Networking

- VMs use TAP devices for networking
- Each VM gets an IP in the 172.16.0.0/24 range
- NAT is configured for outbound internet access
- Port forwarding handles inbound connections

## Firewall Rules

The host firewall (ufw) allows:
- SSH (port 22)
- Management API (port 8080)
- VM ports (10000-20000)
- All traffic from VM network (172.16.0.0/24) - required for NFS shared cache

### NFS Firewall Configuration

VMs need to access the host's NFS server for the shared pnpm and repo caches. The firewall must allow traffic from the VM network:

```bash
# Allow all traffic from VM network to host (required for NFS)
ufw allow from 172.16.0.0/24 comment "Allow all from VMs to host"
```

This is safe because:
- Only VMs on the internal bridge network (172.16.0.0/24) can reach these ports
- External traffic cannot reach these services

## Log Streaming

The frontend displays real-time logs from VMs in the "Logs" tab via SSE (Server-Sent Events).

### How It Works

1. **Frontend** (`FirecrackerPreview.tsx`) connects via SSE to `logsUrl`
2. **Host API** streams logs from `/opt/firecracker/logs/<vm_id>.log`
3. **Setup process** writes logs for each phase: cloning, installing, starting dev server
4. **Dev server output** is continuously streamed via SSH tail

### SSE Endpoint

```
GET /api/vms/:id/logs?token=<secret>
Content-Type: text/event-stream

data: {"line": "=== Starting VM Setup ===", "timestamp": 1708123456789}
data: {"line": "Repository: owner/repo", "timestamp": 1708123456790}
data: {"line": "=== Cloning Repository ===", "timestamp": 1708123456800}
data: {"line": "[dev] ready - started server on 0.0.0.0:3000", "timestamp": 1708123457000}
```

### Log Storage

- Logs stored at: `/opt/firecracker/logs/<vm_id>.log`
- Format: JSON lines `{"line": "...", "timestamp": ...}`
- Auto-deleted when VM is destroyed

### What Gets Logged

- Setup phases (cloning, installing, starting)
- Repository and branch info
- Package manager detection
- Dev server command used
- Dev server output (prefixed with `[dev]`)
- Errors and failures

## Troubleshooting

### Check if Firecracker is working

```bash
ssh root@157.230.181.26 "firecracker --version"
```

### Check KVM support

```bash
ssh root@157.230.181.26 "ls -la /dev/kvm"
```

### View running VMs

```bash
ssh root@157.230.181.26 "ps aux | grep firecracker"
```

### Check API logs

```bash
ssh root@157.230.181.26 "journalctl -u firecracker-manager -n 50"
```

### Manually clean up stuck VMs

```bash
ssh root@157.230.181.26 "rm -rf /opt/firecracker/vms/*"
ssh root@157.230.181.26 "ip link | grep tap | awk -F: '{print \$2}' | xargs -I{} ip link delete {}"
```

## Integration with Artie

To use this Firecracker host instead of individual droplets:

1. Add environment variables to Convex:
   ```
   FIRECRACKER_HOST=157.230.181.26
   FIRECRACKER_API_SECRET=23c17c1952fa688c07da3f738e1058d83624cad71c91e1ccf4172049f80cb5f5
   ```

2. Update the droplet creation logic to call the Firecracker API instead of DigitalOcean API

3. Map the returned `host` port to build preview URLs like:
   ```
   http://157.230.181.26:<host_port>
   ```

## Storage Performance Tuning

Firecracker VMs can have slower storage than the host due to virtio-blk overhead. Two optimizations are available:

### Async I/O Engine (io_uring)

By default, Firecracker uses synchronous I/O which blocks on every operation. Enable the async engine for 2-5x improvement on random I/O workloads (npm install, builds):

```bash
./swarm/scripts/deploy-storage-perf.sh
```

This adds `io_engine: "Async"` to drive configurations, which uses Linux io_uring for non-blocking I/O.

**Requirements:** Host kernel 5.10.51+ (Ubuntu 24.04 has this)

**Manual configuration** (in server.js drive config):

```javascript
{
  drive_id: "rootfs",
  path_on_host: "/path/to/rootfs.ext4",
  is_root_device: true,
  is_read_only: false,
  io_engine: "Async"  // Add this line
}
```

### Pmem (Persistent Memory) - Not Currently Available

Virtio-pmem would provide near-native storage performance by memory-mapping the rootfs, but the current Firecracker kernel (5.10.223) doesn't have `CONFIG_VIRTIO_PMEM` enabled.

**To enable pmem in the future:**
1. Rebuild the vmlinux kernel with `CONFIG_VIRTIO_PMEM=y`
2. Update boot_args to use `root=/dev/pmem0 rootfstype=ext4 rw`
3. Use `pmem` config instead of `drives` in the VM configuration

A helper script exists at `/opt/firecracker/api/configure-pmem.sh` for when kernel support is added.

### Current Performance (Async io_engine)

With `io_engine: "Async"` enabled, typical performance is:

| Metric | Value |
|--------|-------|
| Sequential Write | ~150-200 MB/s |
| Sequential Read | ~500+ MB/s (cached: 5+ GB/s) |
| Random Small Files | < 10ms for 100 files |

This is a significant improvement over the default sync engine and should be sufficient for most dev server workloads.

## Per-Repository Snapshots

Firecracker supports snapshotting VMs to dramatically speed up provisioning for returning repositories. After a repo is cloned and dependencies installed, we snapshot the VM. Future requests for the same repo restore from the snapshot instead of repeating setup.

### Performance Comparison

| Scenario | Time |
|----------|------|
| Fresh VM (no snapshot) | ~40-180s (clone + install + start) |
| Restored from snapshot | ~5-15s (restore + start dev server) |

**Savings:** 90%+ reduction in setup time for cached repositories

### How It Works

1. **First request for repo X**: Normal flow (clone, install, start)
2. **Before starting dev server**: Pause VM, create snapshot, resume
3. **Subsequent requests for repo X**: Restore from snapshot, run incremental git fetch, start dev server

### Snapshot Storage

```
/opt/firecracker/snapshots/
├── {owner}/
│   └── {repo}/
│       └── {branch}/
│           ├── mem              # Guest memory (~500MB-2GB)
│           ├── state            # VM state (~1MB)
│           ├── rootfs.ext4      # Disk snapshot (CoW)
│           └── metadata.json    # Snapshot info
```

### API Endpoints

```bash
# List all snapshots
curl http://157.230.181.26:8080/api/snapshots \
  -H "Authorization: Bearer $API_SECRET"

# Get snapshot info
curl http://157.230.181.26:8080/api/snapshots/{owner}/{repo}/{branch} \
  -H "Authorization: Bearer $API_SECRET"

# Create snapshot from running VM
curl -X POST http://157.230.181.26:8080/api/vms/{vm_id}/snapshot \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"owner": "...", "repo": "...", "branch": "main"}'

# Restore VM from snapshot
curl -X POST http://157.230.181.26:8080/api/snapshots/restore \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"owner": "...", "repo": "...", "branch": "main", "name": "my-vm"}'

# Delete snapshot
curl -X DELETE http://157.230.181.26:8080/api/snapshots/{owner}/{repo}/{branch} \
  -H "Authorization: Bearer $API_SECRET"
```

### Deploying Snapshot Support

```bash
./swarm/scripts/deploy-repo-snapshots.sh
```

### Snapshot Invalidation

Snapshots are automatically cleaned up after 7 days of no access. They can also be manually deleted via API or when:
- User explicitly requests a fresh build
- Package lock file changes significantly

## Cost Comparison

| Approach | Cost for 10 concurrent projects |
|----------|--------------------------------|
| Individual droplets (s-2vcpu-2gb) | $180/month |
| Firecracker host (s-8vcpu-16gb) | $96/month |

**Savings: ~47%** plus much faster startup times (< 1s vs 60-90s).

## Maintenance

### Update Firecracker

```bash
ssh root@157.230.181.26 << 'EOF'
ARCH=$(uname -m)
release_url="https://github.com/firecracker-microvm/firecracker/releases"
latest=$(curl -fsSLI -o /dev/null -w %{url_effective} ${release_url}/latest)
latest_version="${latest##*/}"
cd /tmp
curl -fsSL -o firecracker.tgz "${release_url}/download/${latest_version}/firecracker-${latest_version}-${ARCH}.tgz"
tar -xzf firecracker.tgz
mv release-${latest_version}-${ARCH}/firecracker-${latest_version}-${ARCH} /usr/local/bin/firecracker
mv release-${latest_version}-${ARCH}/jailer-${latest_version}-${ARCH} /usr/local/bin/jailer
chmod +x /usr/local/bin/firecracker /usr/local/bin/jailer
rm -rf /tmp/firecracker.tgz /tmp/release-*
firecracker --version
EOF
```

### Rotate API Secret

```bash
ssh root@157.230.181.26 << 'EOF'
NEW_SECRET=$(openssl rand -hex 32)
echo "API_SECRET=$NEW_SECRET" > /opt/firecracker/.env
systemctl restart firecracker-manager
echo "New secret: $NEW_SECRET"
EOF
```

Then update the `FIRECRACKER_API_SECRET` in Convex environment variables.
