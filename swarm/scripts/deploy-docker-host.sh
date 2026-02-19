#!/bin/bash
# Deploy Docker host on DigitalOcean
# This script provisions a new droplet and sets up the Docker environment.

set -e

# Configuration
DROPLET_NAME="composure-docker-host"
REGION="syd1"
SIZE="s-8vcpu-16gb"
IMAGE="ubuntu-24-04-x64"
SSH_KEY_NAME="Matt Macbook"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Docker Host Deployment ===${NC}"

# Check for doctl
if ! command -v doctl &> /dev/null; then
    echo -e "${RED}Error: doctl is not installed. Install it first:${NC}"
    echo "brew install doctl"
    exit 1
fi

# Check authentication
if ! doctl auth list &> /dev/null; then
    echo -e "${RED}Error: doctl is not authenticated. Run:${NC}"
    echo "doctl auth init"
    exit 1
fi

# Check if droplet already exists
echo -e "${YELLOW}Checking if droplet already exists...${NC}"
EXISTING=$(doctl compute droplet list --format Name --no-header | grep -w "$DROPLET_NAME" || true)
if [ -n "$EXISTING" ]; then
    echo -e "${RED}Error: Droplet '$DROPLET_NAME' already exists.${NC}"
    echo "To delete it: doctl compute droplet delete $DROPLET_NAME"
    exit 1
fi

# Get SSH key ID
echo -e "${YELLOW}Looking up SSH key...${NC}"
SSH_KEY_ID=$(doctl compute ssh-key list --format ID,Name --no-header | grep "$SSH_KEY_NAME" | awk '{print $1}')
if [ -z "$SSH_KEY_ID" ]; then
    echo -e "${RED}Error: SSH key '$SSH_KEY_NAME' not found.${NC}"
    echo "Available keys:"
    doctl compute ssh-key list
    exit 1
fi

echo -e "${GREEN}Using SSH key ID: $SSH_KEY_ID${NC}"

# Create droplet
echo -e "${YELLOW}Creating droplet...${NC}"
doctl compute droplet create "$DROPLET_NAME" \
    --region "$REGION" \
    --size "$SIZE" \
    --image "$IMAGE" \
    --ssh-keys "$SSH_KEY_ID" \
    --tag-names "composure,docker" \
    --wait

# Get droplet IP
echo -e "${YELLOW}Getting droplet IP...${NC}"
DROPLET_IP=$(doctl compute droplet list --format Name,PublicIPv4 --no-header | grep "$DROPLET_NAME" | awk '{print $2}')
echo -e "${GREEN}Droplet IP: $DROPLET_IP${NC}"

# Wait for SSH to be available
echo -e "${YELLOW}Waiting for SSH to be available...${NC}"
for i in {1..30}; do
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@"$DROPLET_IP" "echo 'SSH ready'" 2>/dev/null; then
        break
    fi
    echo "  Attempt $i/30..."
    sleep 10
done

# Run setup script on the droplet
echo -e "${YELLOW}Running initial setup on droplet...${NC}"
ssh -o StrictHostKeyChecking=no root@"$DROPLET_IP" << 'REMOTE_SCRIPT'
set -e

# Update system
apt-get update
apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Enable Docker
systemctl enable docker
systemctl start docker

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Create directory structure
mkdir -p /opt/docker-manager/api
mkdir -p /opt/docker-manager/repo-cache
mkdir -p /opt/docker-manager/logs

# Generate API secret
API_SECRET=$(openssl rand -hex 32)
echo "API_SECRET=$API_SECRET" > /opt/docker-manager/.env
echo "Generated API_SECRET: $API_SECRET"

# Configure firewall
ufw allow 22/tcp
ufw allow 8080/tcp
ufw allow 10000:20000/tcp
ufw --force enable

# Set Docker to use json-file logging with limits
cat > /etc/docker/daemon.json << 'DOCKERCONF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
DOCKERCONF

systemctl restart docker

echo "=== Initial setup complete ==="
echo "Docker version: $(docker --version)"
echo "Node version: $(node --version)"

REMOTE_SCRIPT

echo ""
echo -e "${GREEN}=== Deployment Summary ===${NC}"
echo "Droplet Name: $DROPLET_NAME"
echo "Public IP: $DROPLET_IP"
echo "SSH: ssh root@$DROPLET_IP"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Run deploy-docker-api.sh to deploy the management API"
echo "2. Update DOCKER_HOST and DOCKER_API_SECRET in Convex environment"
echo ""
echo "Get the API secret:"
echo "  ssh root@$DROPLET_IP 'cat /opt/docker-manager/.env'"
