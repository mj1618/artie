# Per-Repository VM Snapshots

Speed up VM provisioning by snapshotting VMs after repo clone + dependency install.
New VMs for the same repository restore from snapshot instead of full setup.

## Overview

**Current flow:**
```
Request VM → Boot (~125ms) → Clone repo (~5-30s) → Install deps (~30-120s) → Start dev server (~5-15s)
Total: ~40-180 seconds
```

**With snapshots:**
```
Request VM → Restore from snapshot (~200ms) → Start dev server (~5-15s)
Total: ~5-15 seconds
```

**Savings:** 90%+ reduction in setup time for returning repositories

---

## Architecture

### Snapshot Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SNAPSHOT CREATION                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Pool VM boots (pre-warmed)                                              │
│  2. User requests VM for repo X                                             │
│  3. Check: Does snapshot exist for repo X + branch?                         │
│     ├─ YES → Go to SNAPSHOT RESTORE flow                                    │
│     └─ NO → Continue to step 4                                              │
│  4. Clone repo, install dependencies                                        │
│  5. Before starting dev server, PAUSE VM                                    │
│  6. Create snapshot:                                                        │
│     ├─ Memory file: /opt/firecracker/snapshots/{owner}/{repo}/{branch}/mem  │
│     ├─ State file:  /opt/firecracker/snapshots/{owner}/{repo}/{branch}/state│
│     └─ Rootfs copy: /opt/firecracker/snapshots/{owner}/{repo}/{branch}/rootfs│
│  7. Resume VM, start dev server                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           SNAPSHOT RESTORE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. User requests VM for repo X (snapshot exists)                           │
│  2. Create NEW Firecracker process (snapshots load before boot)             │
│  3. Copy-on-write clone of snapshot rootfs                                  │
│  4. Load snapshot (memory + state)                                          │
│  5. Resume VM                                                               │
│  6. Run post-restore script:                                                │
│     ├─ Update system clock                                                  │
│     ├─ git fetch + reset (get latest code)                                  │
│     └─ pnpm install (incremental, usually no-op)                            │
│  7. Start dev server                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Storage Layout

```
/opt/firecracker/snapshots/
├── {github_owner}/
│   └── {repo_name}/
│       └── {branch}/
│           ├── mem              # Guest memory (sparse file, ~500MB-2GB)
│           ├── state            # VM state (small, ~1MB)
│           ├── rootfs.ext4      # Disk snapshot (CoW from base)
│           ├── metadata.json    # Snapshot metadata
│           └── .lock            # Lock file for concurrent access
```

### Metadata Schema

```json
{
  "createdAt": 1708123456789,
  "createdBy": "user_id",
  "repoUrl": "https://github.com/owner/repo",
  "branch": "main",
  "commitSha": "abc123...",
  "packageManager": "pnpm",
  "nodeVersion": "20.11.0",
  "firecrackerVersion": "v1.14.1",
  "memoryMb": 2048,
  "vcpus": 2,
  "sizeBytes": {
    "memory": 1073741824,
    "state": 1048576,
    "rootfs": 5368709120
  }
}
```

---

## Implementation Tasks

### Phase 1: Snapshot Infrastructure on Host

- [x] **Create snapshot directory structure** ✅ Deployed 2026-02-18
  - Created `/opt/firecracker/snapshots/` with proper permissions
  - Added cleanup cron job for old snapshots (>7 days unused)

- [x] **Add snapshot helper functions to server.js** ✅ Deployed 2026-02-18
  - `createRepoSnapshot()` - Pause VM, create snapshot, copy rootfs, resume
  - `getSnapshotMetadata()` - Get snapshot info or null
  - `deleteSnapshot()` - Remove snapshot files
  - `listSnapshots()` - List all snapshots

- [x] **Add API endpoints** ✅ Deployed 2026-02-18
  - `POST /api/vms/:id/snapshot` - Create snapshot from running VM
  - `GET /api/snapshots/:owner/:repo/:branch` - Get snapshot info
  - `GET /api/snapshots` - List all snapshots
  - `DELETE /api/snapshots/:owner/:repo/:branch` - Delete snapshot

- [x] **Integrate automatic snapshot creation** ✅ Deployed 2026-02-18
  - After `pnpm install` completes, before starting dev server
  - Snapshots created if none exists or existing is >24h old
  - Reports snapshot to Convex via HTTP callback

### Phase 2: Convex Integration

- [x] **Add `repoSnapshots` table to schema** ✅ Deployed 2026-02-18
  - Tracks repoId, branch, commitSha, sizeBytes, status
  - Indexes: by_repoId, by_repoId_branch, by_status

- [x] **Add HTTP callback endpoint** ✅ Deployed 2026-02-18
  - `/firecracker-snapshot` - Host reports snapshot creation to Convex
  - Records snapshot in `repoSnapshots` table

- [x] **Add snapshot tracking mutations** ✅ Deployed 2026-02-18
  - `recordSnapshot` - Create/update snapshot record
  - `getSnapshot` - Query snapshot by repo+branch
  - `recordSnapshotUsage` - Track usage stats
  - `markSnapshotFailed` - Handle failures

- [x] **Modify VM request flow to use snapshots** ✅ Deployed 2026-02-18
  - Host automatically checks for snapshots in runSetup
  - If snapshot exists (<7 days old), restores /app from snapshot
  - Then fetches latest code via git
  - Runs incremental pnpm install (usually no-op)
  - Records snapshot usage via callback to Convex

- [x] **Add snapshot restore logic** ✅ Deployed 2026-02-18
  - `restoreIntoVm()` - Mounts snapshot rootfs, copies /app
  - Integrated into runSetup flow (automatic)
  - Falls back to full setup if restore fails

### Phase 3: Snapshot Invalidation

- [ ] **Track when snapshots become stale**
  - Store `commitSha` in snapshot metadata
  - On restore, compare with remote HEAD
  - If different, run `git fetch && git reset --hard origin/{branch}`

- [ ] **Manual invalidation**
  - Add "Rebuild Environment" button in UI
  - Deletes snapshot and creates fresh VM

- [ ] **Automatic invalidation triggers**
  - Package.json/pnpm-lock.yaml changes (detected via git diff)
  - User explicitly requests fresh build
  - Snapshot older than X days (configurable, default 7)

### Phase 4: UI/UX Updates

- [ ] **Update status messages**
  - "Restoring from snapshot..." instead of "Cloning repository..."
  - Show time savings: "Ready in 8s (saved ~2min from snapshot)"

- [ ] **Add snapshot management UI**
  - Show snapshot status in repo settings
  - "Delete Snapshot" / "Rebuild" buttons
  - Show snapshot size and age

---

## Firecracker Snapshot API Reference

### Pause VM (required before snapshot)
```bash
curl --unix-socket /tmp/firecracker.socket -i \
    -X PATCH 'http://localhost/vm' \
    -H 'Content-Type: application/json' \
    -d '{"state": "Paused"}'
```

### Create Full Snapshot
```bash
curl --unix-socket /tmp/firecracker.socket -i \
    -X PUT 'http://localhost/snapshot/create' \
    -H 'Content-Type: application/json' \
    -d '{
        "snapshot_type": "Full",
        "snapshot_path": "/path/to/state",
        "mem_file_path": "/path/to/mem"
    }'
```

### Resume VM (after snapshot creation)
```bash
curl --unix-socket /tmp/firecracker.socket -i \
    -X PATCH 'http://localhost/vm' \
    -H 'Content-Type: application/json' \
    -d '{"state": "Resumed"}'
```

### Load Snapshot (new Firecracker process, BEFORE boot)
```bash
curl --unix-socket /tmp/firecracker.socket -i \
    -X PUT 'http://localhost/snapshot/load' \
    -H 'Content-Type: application/json' \
    -d '{
        "snapshot_path": "/path/to/state",
        "mem_backend": {
            "backend_path": "/path/to/mem",
            "backend_type": "File"
        },
        "resume_vm": true
    }'
```

---

## Key Considerations

### Storage Requirements
- Memory snapshot: ~500MB-2GB per repo (depends on node_modules size loaded in memory)
- Rootfs snapshot: ~3-5GB per repo (CoW reduces actual disk usage)
- State file: ~1MB

With 320GB SSD on host, can support ~50-100 repo snapshots.

### Snapshot Validity
- Snapshots are only valid for same Firecracker version
- Snapshots are architecture-specific (x86_64)
- Memory file must remain accessible for VM lifetime (mmap'd)

### Security Notes
- Each snapshot restore gets unique VM generation ID (VMGenID)
- Linux 5.18+ re-seeds kernel PRNG on restore (guest has this)
- Network connections don't survive restore (expected, we reconnect)

### Post-Restore Script
After restoring from snapshot, run inside VM:
```bash
#!/bin/bash
# Sync system clock
chronyc makestep 2>/dev/null || ntpdate -s time.google.com || true

# Update code (incremental)
cd /app
git fetch origin
git reset --hard origin/${BRANCH}

# Incremental dependency install (usually no-op if lock unchanged)
pnpm install --frozen-lockfile 2>/dev/null || npm ci 2>/dev/null || yarn --frozen-lockfile
```

---

## Rollout Plan

1. **Deploy snapshot infrastructure** (host-side changes only)
2. **Test with single repo** (manual snapshot creation/restore)
3. **Enable automatic snapshot creation** (after successful installs)
4. **Enable automatic snapshot restore** (for repos with snapshots)
5. **Add UI for snapshot management**
6. **Monitor and tune** (snapshot size, invalidation triggers)

---

## Success Metrics

- **Setup time reduction**: Target 90%+ for cached repos
- **Storage efficiency**: <100GB for all snapshots combined  
- **Snapshot hit rate**: >80% of VM requests use snapshots
- **Freshness**: Code <5min behind remote after restore
