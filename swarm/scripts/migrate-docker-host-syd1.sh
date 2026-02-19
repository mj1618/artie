#!/bin/bash
# Migrate Docker host from NYC1 to SYD1
#
# Steps:
#   1. Snapshot the current artie-docker-host droplet
#   2. Transfer the snapshot to syd1
#   3. Create a new droplet (composure-docker-host) in syd1 from the snapshot
#   4. Verify SSH + Docker work on the new droplet
#   5. Print new IP + next steps (update Convex env vars, destroy old droplet)
#
# Prerequisites:
#   - doctl authenticated (doctl auth init)
#   - SSH key accessible to both old and new droplet

set -e

# ── Configuration ──────────────────────────────────────────────
OLD_DROPLET_NAME="artie-docker-host"
NEW_DROPLET_NAME="composure-docker-host"
NEW_REGION="syd1"
SIZE="s-8vcpu-16gb"
SNAPSHOT_NAME="artie-docker-host-migration-$(date +%Y%m%d-%H%M%S)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}▸ $*${NC}"; }
ok()    { echo -e "${GREEN}✓ $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠ $*${NC}"; }
fail()  { echo -e "${RED}✗ $*${NC}"; exit 1; }

# ── Preflight checks ──────────────────────────────────────────
command -v doctl &>/dev/null || fail "doctl not installed. brew install doctl"
doctl auth list &>/dev/null  || fail "doctl not authenticated. Run: doctl auth init"

# ── Resolve old droplet ───────────────────────────────────────
info "Looking up droplet '$OLD_DROPLET_NAME'..."
OLD_DROPLET_ID=$(doctl compute droplet list --format ID,Name --no-header \
  | grep -w "$OLD_DROPLET_NAME" | awk '{print $1}')
[ -n "$OLD_DROPLET_ID" ] || fail "Droplet '$OLD_DROPLET_NAME' not found."
OLD_IP=$(doctl compute droplet get "$OLD_DROPLET_ID" --format PublicIPv4 --no-header)
ok "Found droplet $OLD_DROPLET_ID ($OLD_IP)"

# ── Check new droplet doesn't already exist ───────────────────
EXISTING=$(doctl compute droplet list --format Name --no-header | grep -w "$NEW_DROPLET_NAME" || true)
[ -z "$EXISTING" ] || fail "Droplet '$NEW_DROPLET_NAME' already exists. Delete it first or pick another name."

# ── Step 1: Snapshot ──────────────────────────────────────────
info "Creating snapshot '$SNAPSHOT_NAME' (this may take a few minutes)..."
doctl compute droplet-action snapshot "$OLD_DROPLET_ID" --snapshot-name "$SNAPSHOT_NAME" --wait
ok "Snapshot created"

# ── Get snapshot ID ───────────────────────────────────────────
info "Looking up snapshot..."
SNAPSHOT_ID=$(doctl compute snapshot list --format ID,Name --no-header \
  | grep "$SNAPSHOT_NAME" | awk '{print $1}')
[ -n "$SNAPSHOT_ID" ] || fail "Snapshot '$SNAPSHOT_NAME' not found after creation."
ok "Snapshot ID: $SNAPSHOT_ID"

# ── Step 2: Transfer snapshot to SYD1 ─────────────────────────
info "Transferring snapshot to $NEW_REGION (this can take 10-30 minutes)..."
doctl compute image-action transfer "$SNAPSHOT_ID" --region "$NEW_REGION" --wait
ok "Snapshot transferred to $NEW_REGION"

# ── Step 3: Create new droplet ────────────────────────────────
info "Resolving SSH keys from old droplet..."
SSH_KEY_IDS=$(doctl compute ssh-key list --format ID --no-header | tr '\n' ',' | sed 's/,$//')
[ -n "$SSH_KEY_IDS" ] || fail "No SSH keys found in your account."
ok "Using SSH keys: $SSH_KEY_IDS"

info "Creating droplet '$NEW_DROPLET_NAME' in $NEW_REGION..."
doctl compute droplet create "$NEW_DROPLET_NAME" \
  --region "$NEW_REGION" \
  --size "$SIZE" \
  --image "$SNAPSHOT_ID" \
  --ssh-keys "$SSH_KEY_IDS" \
  --tag-names "composure,docker" \
  --wait
ok "Droplet created"

NEW_IP=$(doctl compute droplet list --format Name,PublicIPv4 --no-header \
  | grep -w "$NEW_DROPLET_NAME" | awk '{print $2}')
ok "New droplet IP: $NEW_IP"

# ── Step 4: Wait for SSH + verify Docker ──────────────────────
info "Waiting for SSH on $NEW_IP..."
for i in {1..30}; do
  if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@"$NEW_IP" "echo ok" 2>/dev/null; then
    break
  fi
  echo "  Attempt $i/30..."
  sleep 10
done

info "Verifying Docker..."
DOCKER_VER=$(ssh -o StrictHostKeyChecking=no root@"$NEW_IP" "docker --version" 2>/dev/null || true)
[ -n "$DOCKER_VER" ] || fail "Docker not responding on new droplet."
ok "Docker OK: $DOCKER_VER"

info "Verifying docker-manager service..."
MANAGER_STATUS=$(ssh -o StrictHostKeyChecking=no root@"$NEW_IP" \
  "systemctl is-active docker-manager 2>/dev/null || echo 'inactive'" 2>/dev/null)
if [ "$MANAGER_STATUS" = "active" ]; then
  ok "docker-manager service is running"
else
  warn "docker-manager service is $MANAGER_STATUS — you may need to restart it"
fi

# ── Step 5: Print summary ─────────────────────────────────────
API_SECRET=$(ssh -o StrictHostKeyChecking=no root@"$NEW_IP" \
  "grep API_SECRET /opt/docker-manager/.env 2>/dev/null | cut -d= -f2" 2>/dev/null || true)

echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  Migration Complete!${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo "  Old droplet:  $OLD_DROPLET_NAME ($OLD_IP) — NYC1"
echo "  New droplet:  $NEW_DROPLET_NAME ($NEW_IP) — SYD1"
echo ""
if [ -n "$API_SECRET" ]; then
  echo "  API Secret:   $API_SECRET"
fi
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo ""
echo "  1. Update Convex environment variables:"
echo "       DOCKER_HOST=$NEW_IP"
echo "       DOCKER_HOST_URL=http://$NEW_IP:8081"
echo "     (keep DOCKER_API_SECRET the same — it transferred with the snapshot)"
echo ""
echo "  2. Verify the API is healthy:"
echo "       curl http://$NEW_IP:8081/health"
echo ""
echo "  3. Once confirmed working, destroy the old droplet:"
echo "       doctl compute droplet delete $OLD_DROPLET_NAME --force"
echo ""
echo "  4. Clean up the migration snapshot (optional):"
echo "       doctl compute snapshot delete $SNAPSHOT_ID --force"
echo ""
