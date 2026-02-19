#!/bin/bash
# Build the base Docker image on the Docker host
# Usage: DOCKER_HOST_IP=1.2.3.4 ./build-base-image.sh

set -e

DOCKER_HOST_IP="${DOCKER_HOST_IP:-170.64.207.67}"
IMAGE_TAG="node:24-slim-git"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Building base image on Docker host ===${NC}"
echo "Target: root@$DOCKER_HOST_IP"
echo "Image: $IMAGE_TAG"

echo -e "${YELLOW}Copying Dockerfile to host...${NC}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
scp -o StrictHostKeyChecking=no "$SCRIPT_DIR/../../docker/base-image/Dockerfile" root@"$DOCKER_HOST_IP":/tmp/base-image-Dockerfile

echo -e "${YELLOW}Building image on host (this may take a few minutes)...${NC}"
ssh -o StrictHostKeyChecking=no root@"$DOCKER_HOST_IP" << REMOTE
set -e
cd /tmp
docker build -t "$IMAGE_TAG" -f base-image-Dockerfile .
rm -f base-image-Dockerfile
echo ""
echo "Image built:"
docker images "$IMAGE_TAG"
REMOTE

echo ""
echo -e "${GREEN}=== Done ===${NC}"
echo "Image '$IMAGE_TAG' is now available on the Docker host."
echo "New containers will automatically use it."
