#!/bin/bash
set -e

PROJECT_DIR="/app/project"
API_LOG="/var/log/sprite-api.log"
DEV_LOG="/var/log/dev-server.log"

# Function to report status to Convex
# Supports both Fly.io sprites (APP_NAME) and DigitalOcean droplets (DROPLET_NAME)
report_status() {
  local status="$1"
  local error="$2"
  
  # Determine which mode we're in based on environment variables
  # DigitalOcean mode: DROPLET_NAME is set
  # Fly.io mode: APP_NAME is set
  local identifier=""
  local endpoint=""
  local id_field=""
  local status_field=""
  
  if [ -n "$DROPLET_NAME" ]; then
    # DigitalOcean droplet mode
    identifier="$DROPLET_NAME"
    endpoint="${CONVEX_SITE_URL}/droplet-status"
    id_field="dropletName"
    status_field="status"
  elif [ -n "$APP_NAME" ]; then
    # Fly.io sprite mode (legacy)
    identifier="$APP_NAME"
    endpoint="${CONVEX_SITE_URL}/sprite-status"
    id_field="appName"
    status_field="cloneStatus"
  fi
  
  if [ -n "$CONVEX_SITE_URL" ] && [ -n "$identifier" ] && [ -n "$API_SECRET" ]; then
    echo "Reporting status to Convex: $status"
    echo "URL: $endpoint"
    local response
    response=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$endpoint" \
      -H "Content-Type: application/json" \
      -d "{\"${id_field}\":\"${identifier}\",\"apiSecret\":\"${API_SECRET}\",\"${status_field}\":\"${status}\"${error:+,\"error\":\"$error\"}}")
    echo "Response: $response"
  else
    echo "Warning: Cannot report status - missing CONVEX_SITE_URL ($CONVEX_SITE_URL), identifier (APP_NAME=$APP_NAME, DROPLET_NAME=$DROPLET_NAME), or API_SECRET"
  fi
}

echo "=== Sprite Container Starting ==="
echo "GITHUB_REPO: ${GITHUB_REPO}"
echo "GITHUB_BRANCH: ${GITHUB_BRANCH}"
echo "CONVEX_SITE_URL: ${CONVEX_SITE_URL}"
if [ -n "$DROPLET_NAME" ]; then
  echo "Mode: DigitalOcean Droplet"
  echo "DROPLET_NAME: ${DROPLET_NAME}"
elif [ -n "$APP_NAME" ]; then
  echo "Mode: Fly.io Sprite"
  echo "APP_NAME: ${APP_NAME}"
fi
echo "API_SECRET set: $([ -n "$API_SECRET" ] && echo 'yes' || echo 'no')"

# Start the API server in the background first (so we can report status)
echo "Starting API server..."
cd /app/sprite-server
node server.js > "$API_LOG" 2>&1 &
API_PID=$!
echo "API server started (PID: $API_PID)"

# Wait for API server to be ready
sleep 2

# Clone the repository
if [ -n "$GITHUB_REPO" ]; then
  # Report cloning status
  report_status "cloning"
  
  echo "Cloning repository..."
  
  # Build clone URL with token if available
  if [ -n "$GITHUB_TOKEN" ]; then
    CLONE_URL="https://${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git"
  else
    CLONE_URL="https://github.com/${GITHUB_REPO}.git"
  fi
  
  # Clone with specific branch
  BRANCH="${GITHUB_BRANCH:-main}"
  echo "Cloning branch: $BRANCH"
  
  rm -rf "$PROJECT_DIR"
  if ! git clone --depth 1 --branch "$BRANCH" "$CLONE_URL" "$PROJECT_DIR" 2>&1; then
    echo "Failed to clone branch $BRANCH, trying default branch..."
    if ! git clone --depth 1 "$CLONE_URL" "$PROJECT_DIR" 2>&1; then
      report_status "failed" "Failed to clone repository"
      exit 1
    fi
  fi
  
  cd "$PROJECT_DIR"
  echo "Repository cloned successfully"
  
  # Report installing status
  report_status "installing"
  
  # Install dependencies using pnpm with optimized settings
  echo "Installing dependencies with pnpm..."
  if [ -f "package.json" ]; then
    # Configure pnpm for this install
    export PNPM_HOME="/root/.local/share/pnpm"
    
    # Use --prefer-offline to use cached packages from pre-warmed store
    # Use --reporter=silent for less output overhead
    # If lockfile exists, try frozen-lockfile first for fastest install
    PNPM_OPTS="--prefer-offline --reporter=silent"
    
    if [ -f "pnpm-lock.yaml" ]; then
      echo "Found pnpm-lock.yaml, using frozen lockfile..."
      if ! pnpm install $PNPM_OPTS --frozen-lockfile 2>&1; then
        echo "Frozen lockfile failed, falling back to regular install..."
        pnpm install $PNPM_OPTS 2>&1
      fi
    elif [ -f "package-lock.json" ]; then
      # Project uses npm, import the lockfile first for better caching
      echo "Found package-lock.json, importing to pnpm..."
      pnpm import 2>&1 || true
      pnpm install $PNPM_OPTS 2>&1
    elif [ -f "yarn.lock" ]; then
      # Project uses yarn, import the lockfile first for better caching
      echo "Found yarn.lock, importing to pnpm..."
      pnpm import 2>&1 || true
      pnpm install $PNPM_OPTS 2>&1
    else
      echo "No lockfile found, running fresh install..."
      pnpm install $PNPM_OPTS 2>&1
    fi
    echo "Dependencies installed"
  else
    echo "No package.json found, skipping install"
  fi
  
  # Detect and start dev server
  echo "Starting dev server..."
  
  # Check for common dev server configurations
  if [ -f "package.json" ]; then
    # Check if there's a dev script
    if grep -q '"dev"' package.json; then
      pnpm dev > "$DEV_LOG" 2>&1 &
      DEV_PID=$!
      echo "Dev server started (PID: $DEV_PID)"
    elif grep -q '"start"' package.json; then
      pnpm start > "$DEV_LOG" 2>&1 &
      DEV_PID=$!
      echo "Dev server started (PID: $DEV_PID)"
    fi
  fi
  
  # Wait a moment for dev server to start
  sleep 3
  
  # Report ready status
  report_status "ready"
else
  echo "No GITHUB_REPO specified, skipping clone"
  report_status "ready"
fi

echo "=== Container ready ==="

# Keep the container running and forward signals
wait $API_PID
