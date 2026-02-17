# Firecracker Host for Artie

This document describes the Firecracker microVM host used to run project development environments.

## Overview

Instead of spinning up individual DigitalOcean droplets per project/session, we use a single powerful droplet running Firecracker to manage lightweight microVMs. Each microVM boots in under 1 second and uses minimal resources.

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

With 16GB RAM on the host:

| VM Memory | Max VMs |
|-----------|---------|
| 512 MB | ~30 |
| 1 GB | ~15 |
| 2 GB | ~7 |

Leave some headroom for the host OS (~1-2GB).

## Directory Structure on Host

```
/opt/firecracker/
├── api/                    # Management API
│   ├── server.js
│   └── package.json
├── kernels/
│   └── vmlinux            # Linux kernel for VMs
├── rootfs/
│   ├── ubuntu-22.04.ext4  # Base rootfs image
│   └── rootfs.ext4        # Symlink to default
├── vms/                   # Running VM data
│   └── <vm_id>/
│       ├── config.json
│       ├── rootfs.ext4    # Copy for this VM
│       └── firecracker.sock
├── .env                   # API_SECRET
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
