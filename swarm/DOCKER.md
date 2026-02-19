# Docker Host for Artie

This document describes the Docker container host used to run project development environments.

## Overview

Instead of using Firecracker VMs, this runtime uses Docker containers on a single DigitalOcean droplet. Containers share resources efficiently and leverage prebuilt images for fast startup times.

## Key Features

- **Prebuilt Main Images**: First request for a repo builds a Docker image with dependencies installed
- **Branch Switching**: Subsequent requests start from the main image and checkout the desired branch
- **Shared node_modules**: Volume-based caching shares packages across all branches of a repo
- **Container Pool**: Pre-warmed containers eliminate startup latency

## Container Pool (Instant Provisioning)

Similar to Firecracker, we maintain a pool of pre-warmed containers.

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

## Directory Structure on Host

```
/opt/docker-manager/
├── api/
│   ├── server.js          # Express API
│   └── package.json
├── repo-cache/            # Shared git cache (bare repos)
├── logs/                  # Container logs
└── .env                   # API_SECRET
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
- Management API (port 8080)
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
DOCKER_HOST_URL=http://<droplet_ip>:8080
DOCKER_API_SECRET=<random_64_char_hex>
```

## Integration with Artie

1. Set repo runtime to `docker` in settings
2. Convex backend calls Docker host API
3. Host manages container lifecycle
4. Status updates flow via HTTP callbacks

## Cost Comparison

| Approach | Cost for 10 concurrent projects |
|----------|--------------------------------|
| Firecracker (s-8vcpu-16gb) | $96/month |
| Docker (s-8vcpu-16gb) | $96/month |

Docker has similar cost but simpler setup and broader compatibility.

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
