# Docker Host for Artie

This document describes the Docker container host used to run project development environments.

## Overview

Docker containers run on a single DigitalOcean droplet. Containers share resources efficiently and leverage prebuilt images for fast startup times.

## Key Features

- **Prebuilt Main Images**: First request for a repo builds a Docker image with dependencies installed
- **Branch Switching**: Subsequent requests start from the main image and checkout the desired branch
- **Shared node_modules**: Volume-based caching shares packages across all branches of a repo
- **Container Pool**: Pre-warmed containers eliminate startup latency

## Container Pool (Instant Provisioning)

We maintain a pool of pre-warmed containers.

### How It Works

1. **Background Pool**: The system maintains 3 ready containers at all times
2. **Instant Assignment**: When a user requests a container, we assign a pooled one
3. **Skip Creation Phase**: Pooled containers go directly to "cloning"
4. **Auto-Replenish**: The pool automatically refills in the background

### Pool Configuration

Edit `convex/dockerPool.ts` to adjust:

```typescript
export const POOL_CONFIG = {
  targetSize: 3,     // Target number of ready containers
  minSize: 1,        // Minimum before urgent replenishment
  maxCreating: 2,    // Max concurrent container creations
  containerPorts: [3000],
};
```

## Host Details

| Property | Value |
|----------|-------|
| **Droplet Name** | composure-docker-host |
| **Public IP** | TBD (after provisioning) |
| **Specs** | 8 vCPUs, 16GB RAM, 320GB SSD |
| **Cost** | ~$96/month |
| **Region** | SYD1 |
| **OS** | Ubuntu 24.04 LTS |

## SSH Access

```bash
ssh root@<DOCKER_HOST_IP>
```

## Management API

The Docker Manager API runs on port 8080 and manages container lifecycle.

### Authentication

All `/api/*` endpoints require Bearer token authentication:

```bash
Authorization: Bearer <API_SECRET>
```

Store this in Convex environment variables as `DOCKER_API_SECRET`.

### Endpoints

#### Health Check (no auth required)

```bash
curl http://<HOST_IP>:8080/health
```

Response:
```json
{
  "status": "ok",
  "containerCount": 3,
  "uptime": 123.45
}
```

#### List All Containers

```bash
curl http://<HOST_IP>:8080/api/containers \
  -H "Authorization: Bearer $API_SECRET"
```

#### Get Container Details

```bash
curl http://<HOST_IP>:8080/api/containers/<container_id> \
  -H "Authorization: Bearer $API_SECRET"
```

#### Create Container

```bash
curl -X POST http://<HOST_IP>:8080/api/containers \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-project",
    "image": "node:24-slim",
    "ports": [3000],
    "volumeName": "owner-repo-node_modules"
  }'
```

**Parameters:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Human-readable name for the container |
| `image` | string | node:24-slim | Docker image to use |
| `ports` | number[] | [3000] | Container ports to expose |
| `volumeName` | string | optional | Named volume for node_modules |
| `pool` | boolean | false | Whether this is a pool container |

**Response:**
```json
{
  "id": "abc12345",
  "name": "my-project",
  "hostPort": 10000
}
```

#### Setup Container (Clone + Install + Start)

```bash
curl -X POST http://<HOST_IP>:8080/api/containers/<container_id>/setup \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "owner/repo",
    "branch": "main",
    "githubToken": "gho_...",
    "callbackUrl": "https://your-convex.convex.site/docker-status",
    "callbackSecret": "secret123",
    "hasMainImage": false,
    "buildMainImage": true,
    "envVars": {"NODE_ENV": "development"}
  }'
```

#### Destroy Container

```bash
curl -X DELETE http://<HOST_IP>:8080/api/containers/<container_id> \
  -H "Authorization: Bearer $API_SECRET"
```

#### Execute Command

```bash
curl -X POST http://<HOST_IP>:8080/api/containers/<container_id>/exec \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"command": "ls -la /app", "timeout": 60000}'
```

#### Terminal WebSocket

Connect via WebSocket for interactive shell access:

```
ws://<HOST_IP>:8080/api/containers/<container_id>/terminal?token=<API_SECRET_OR_CALLBACK_SECRET>
```

#### Logs SSE

Stream container logs via Server-Sent Events:

```
GET /api/containers/<container_id>/logs?token=<API_SECRET>
Content-Type: text/event-stream

data: {"line": "[dev] ready on port 3000", "timestamp": 1708123456789}
```

## Port Mapping

Each container gets a unique host port:

- Container port 3000 → Host port 10000 + (container_index)
- Ports are recycled when containers are destroyed

To access a container's dev server externally:
```
http://<HOST_IP>:<host_port>
```

## Capacity Planning

With 16GB RAM on the host:

| Container Memory | Max Containers |
|-----------------|----------------|
| 512 MB | ~30 |
| 1 GB | ~15 |
| 2 GB | ~7 |

Leave some headroom for the host OS (~1-2GB).

## Prebuilt Main Images

### How It Works

1. **First request for repo X**: Clone main branch, install deps, commit as image `owner-repo:main`
2. **Subsequent requests**: Start from the prebuilt image, skip install (incremental only)
3. **Branch requests**: Start from main image, checkout branch, incremental pnpm install

### Image Storage

```
/var/lib/docker/
└── images/
    └── <owner>-<repo>:main  # Prebuilt images
```

### Benefits

- **Faster startup**: Skip full dependency installation
- **Consistent environment**: All branches start from same base
- **Efficient storage**: Docker layer caching minimizes disk usage

## Shared pnpm Store

All containers share a global pnpm content-addressable store.

### How It Works

1. Host directory `/opt/docker-manager/pnpm-store` is bind-mounted into every container at `/pnpm-store`
2. The base image configures `pnpm config set store-dir /pnpm-store`
3. When any container installs a package, it's stored in the shared store
4. Subsequent containers hard-link from the store instead of downloading

### Benefits

- **Dramatically faster installs**: After the first install of any package across any repo, it's a local hard-link
- **Reduced network**: Packages only download once across all repos
- **Disk efficiency**: Content-addressable store deduplicates across all repos

## Shared node_modules Volume

### How It Works

Each repo gets a named Docker volume: `{owner}-{repo}-node_modules`

1. Volume mounted at `/app/node_modules` in all containers for that repo
2. First install populates the volume
3. Subsequent containers reuse the cached packages
4. Incremental `pnpm install` handles branch differences

### Benefits

- **Faster installs**: Packages cached across branches
- **Disk efficiency**: Single copy of node_modules per repo
- **No network overhead**: Packages already on disk

## Shared Git Repository Cache

All containers share a local bare repository cache.

### Cache Location

```
/opt/docker-manager/repo-cache/
├── owner1/
│   ├── repo-a.git/
│   └── repo-b.git/
└── owner2/
    └── repo-c.git/
```

### How It Works

1. **First clone**: Downloads from GitHub to bare repo cache
2. **Subsequent clones**: Clone from local cache (10x faster)
3. **Auto-update**: `git fetch` before each clone

## CRIU Checkpoint/Restore

Docker containers can be checkpointed using CRIU (Checkpoint/Restore in Userspace) to dramatically speed up provisioning for returning repositories. After dependencies are installed, we checkpoint the container state. Future requests for the same repo restore from the checkpoint instead of repeating clone + install.

### Performance Comparison

| Scenario | Time |
|----------|------|
| Fresh container (no checkpoint) | ~20-160s (clone + install + start) |
| Restored from checkpoint | ~5-15s (restore + git pull + start dev server) |

### How It Works

1. **First request for repo X**: Normal flow (clone, install, checkpoint, start)
2. **After install**: CRIU checkpoint created (`--leave-running` so the current session isn't interrupted)
3. **Subsequent requests for repo X**: Restore from checkpoint, pull latest changes, start dev server

### Requirements

- Docker daemon with `--experimental` flag enabled
- `criu` package installed on the host
- Sufficient disk space for checkpoint data

### Checkpoint Storage

```
/opt/docker-manager/checkpoints/
└── cp-owner-repo-branch/     # CRIU checkpoint files
```

### API Endpoints

```bash
# Create checkpoint from running container
curl -X POST http://<HOST_IP>:8080/api/containers/<id>/checkpoint \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"checkpointName": "cp-owner-repo-main"}'

# Restore container from checkpoint
curl -X POST http://<HOST_IP>:8080/api/checkpoints/<name>/restore \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"containerName": "my-container", "ports": [3000]}'

# List checkpoints
curl http://<HOST_IP>:8080/api/checkpoints \
  -H "Authorization: Bearer $API_SECRET"

# Delete checkpoint
curl -X DELETE http://<HOST_IP>:8080/api/checkpoints/<name> \
  -H "Authorization: Bearer $API_SECRET"
```

## Anthropic API Key Proxy

The Docker host runs a reverse proxy (port 8082) so that containers never hold real Anthropic API keys. Claude Code runs inside containers and talks to the proxy instead of `api.anthropic.com` directly.

### How It Works

1. Containers receive `ANTHROPIC_BASE_URL=http://172.17.0.1:8082` and a dummy `ANTHROPIC_API_KEY` (starts with `sk-ant-` to pass Claude Code's format check)
2. When Claude Code makes an API request, it hits the proxy on the Docker bridge gateway
3. The proxy replaces the dummy key with the real one and forwards to `api.anthropic.com`
4. Responses (including streams) are piped back to the container

### Team-Specific Keys

The Convex backend passes the real API key to the Docker host as `anthropicApiKey` in the setup payload (separate from `envVars`). During setup, the host registers a mapping from the container's Docker bridge IP to the real key. The proxy looks up the source IP on each request. If no per-container key is registered, it falls back to the platform default `ANTHROPIC_API_KEY` from `/opt/docker-manager/.env`.

### Configuration

Add the platform default API key to the Docker host:

```bash
ssh root@<HOST_IP> 'echo "ANTHROPIC_API_KEY=sk-ant-..." >> /opt/docker-manager/.env && systemctl restart docker-manager'
```

### Key Management Endpoints

```bash
# Register per-container key (called automatically during setup)
curl -X POST http://<HOST_IP>:8081/api/proxy-keys/<container_id> \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "sk-ant-..."}'

# Deregister (called automatically on container delete)
curl -X DELETE http://<HOST_IP>:8081/api/proxy-keys/<container_id> \
  -H "Authorization: Bearer $API_SECRET"
```

## Directory Structure on Host

```
/opt/docker-manager/
├── api/
│   ├── server.js          # Express API
│   └── package.json
├── repo-cache/            # Shared git cache (bare repos)
├── pnpm-store/            # Shared pnpm content-addressable store
├── checkpoints/           # CRIU container checkpoints
├── logs/                  # Container logs
└── .env                   # API_SECRET, ANTHROPIC_API_KEY
```

## Systemd Service

The API runs as a systemd service:

```bash
# Check status
systemctl status docker-manager

# View logs
journalctl -u docker-manager -f

# Restart
systemctl restart docker-manager
```

## Firewall Rules

The host firewall (ufw) allows:
- SSH (port 22)
- Management API (port 8081)
- Anthropic API proxy (port 8082) -- bound to 172.17.0.1 only, not exposed externally
- Container ports (10000-20000)

## Log Streaming

The frontend displays real-time logs from containers via SSE.

### How It Works

1. **Frontend** connects via SSE to `logsUrl`
2. **Host API** streams logs from Docker
3. **Setup process** writes logs for each phase
4. **Dev server output** is continuously streamed

## Environment Variables

Add to Convex:

```
DOCKER_HOST=<droplet_ip>
DOCKER_HOST_URL=http://<droplet_ip>:8081
DOCKER_API_SECRET=<random_64_char_hex>
CLAUDE_API_KEY=sk-ant-...  (platform default, also used as proxy fallback)
```

Add to Docker host `/opt/docker-manager/.env`:

```
API_SECRET=<random_64_char_hex>
ANTHROPIC_API_KEY=sk-ant-...  (platform default for the proxy)
```

## Integration with Artie

1. Set repo runtime to `docker` in settings
2. Convex backend calls Docker host API
3. Host manages container lifecycle
4. Status updates flow via HTTP callbacks

## Troubleshooting

### Check if Docker is working

```bash
ssh root@<HOST_IP> "docker info"
```

### View running containers

```bash
ssh root@<HOST_IP> "docker ps"
```

### Check API logs

```bash
ssh root@<HOST_IP> "journalctl -u docker-manager -n 50"
```

### Manually clean up containers

```bash
ssh root@<HOST_IP> "docker rm -f \$(docker ps -aq)"
```

### Check disk usage

```bash
ssh root@<HOST_IP> "docker system df"
```

### Prune unused resources

```bash
ssh root@<HOST_IP> "docker system prune -a"
```

## Maintenance

### Rotate API Secret

```bash
ssh root@<HOST_IP> << 'EOF'
NEW_SECRET=$(openssl rand -hex 32)
echo "API_SECRET=$NEW_SECRET" > /opt/docker-manager/.env
systemctl restart docker-manager
echo "New secret: $NEW_SECRET"
EOF
```

Then update the `DOCKER_API_SECRET` in Convex environment variables.

### Update Docker

```bash
ssh root@<HOST_IP> "apt update && apt upgrade -y docker-ce docker-ce-cli containerd.io"
```

### Clean old images

```bash
ssh root@<HOST_IP> "docker image prune -a --filter 'until=168h'"
```
