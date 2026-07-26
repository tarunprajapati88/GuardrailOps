---
name: wsl-native-docker-dns
description: Fixes Docker embedded DNS resolution failures (SERVFAIL) and container crashes when running Native Docker Engine inside WSL on Windows.
---

# WSL Native Docker DNS Fix

When running complex containerized applications (like SigNoz or ClickHouse) on Windows, Docker Desktop's virtualization layer may cause segmentation faults (e.g., exit code 139). The solution is to use the Native Docker Engine inside WSL. 

However, Native Docker in WSL suffers from a DNS bug where `systemd-resolved` breaks Docker's embedded DNS server, preventing containers from resolving each other by name (e.g., `lookup <container-name> on 10.255.255.254:53: dial udp: network is unreachable`).

To successfully run Native Docker in WSL, you must perform the following steps:

### 1. Stop Docker Desktop and Start Native Engine
Ensure Docker Desktop is fully shut down on Windows, then start the native WSL service:
```bash
# In Windows PowerShell:
wsl -u root service docker start
```

### 2. Fix the Docker Daemon DNS (Bypass systemd-resolved)
You must explicitly configure Docker to use external DNS servers (like Google's) to prevent it from forwarding internal queries to the broken WSL `systemd-resolved` stub.

Create or update `/etc/docker/daemon.json` inside WSL:
```json
{
  "dns": ["8.8.8.8", "8.8.4.4"]
}
```

Then restart the Docker service:
```bash
wsl -u root service docker restart
```

### 3. Purge Corrupted Docker Networks
If the environment was previously run under Docker Desktop, the existing Docker networks will have cached the broken DNS resolvers. You **must** completely tear down and recreate the networks:

```bash
# 1. Stop all containers connected to the network
wsl bash -c "docker compose down"

# 2. Force remove the network if it still exists
wsl bash -c "docker network rm <network-name>"

# 3. Bring the containers back up to recreate a pristine network
wsl bash -c "docker compose up -d"
```
