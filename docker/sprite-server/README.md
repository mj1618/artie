# Sprite Server

Fly.io container image for running dev server previews with file operation and command execution APIs.

## Building

```bash
# Build locally
docker build -t artie-sprite-base .

# Build and push to Fly.io registry
fly auth docker
docker build -t registry.fly.io/artie-sprite-base:latest .
docker push registry.fly.io/artie-sprite-base:latest

# IMPORTANT: After pushing, update the SPRITE_IMAGE digest in convex/flyioSprites.ts
# Get the digest with:
docker inspect --format='{{index .RepoDigests 0}}' registry.fly.io/artie-sprite-base:latest
```

## Performance Notes

The Docker image pre-warms the pnpm store with commonly used packages (React, Next.js, 
Tailwind, Radix UI, etc.) to speed up `pnpm install` in sprite containers. When user 
projects use these same package versions, installs are significantly faster since 
packages are already in the local store.

If `pnpm install` is still slow for a specific project:
1. The project may use packages/versions not in the pre-warmed cache
2. Network latency to npm registry adds overhead for uncached packages
3. Consider adding frequently-used packages to the Dockerfile pre-warm step

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_REPO` | Repository to clone (e.g., `owner/repo`) | - |
| `GITHUB_BRANCH` | Branch to clone | `main` |
| `GITHUB_TOKEN` | GitHub token for private repos | - |
| `API_SECRET` | Secret for API authentication | - |
| `API_PORT` | Port for the API server | `3001` |
| `PROJECT_DIR` | Directory for the cloned project | `/app/project` |

## API Endpoints

All endpoints require `Authorization: Bearer <API_SECRET>` header.

### Health Check
```
GET /health
```

### Clone Status
```
GET /clone-status
```

### Read File
```
GET /files/read?path=src/index.ts
```

### Read Multiple Files
```
POST /files/read-batch
{
  "paths": ["src/index.ts", "package.json"]
}
```

### Write Files
```
POST /files/write
{
  "files": [
    { "path": "src/index.ts", "content": "..." }
  ]
}
```

### Get File Tree
```
GET /files/tree?maxSize=100000
```

### Execute Command
```
POST /exec
{
  "command": "npm install lodash",
  "timeout": 60000
}
```

## Ports

- `3000` - Dev server (Next.js, Vite, etc.)
- `3001` - API server (internal)
