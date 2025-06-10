# DevPod Troubleshooting Guide

This guide helps resolve common issues when running DevPod with devcontainers.

## Common Issues and Solutions

### 1. "No space left on device" Error

**Symptoms:**
- `write /home/devpod/.docker-daemon/tmp/GetImageBlob...: no space left on device`
- DevPod fails to start with exit status 1

**Solutions:**

#### Quick Fix - Run Cleanup Script
```bash
# Run the automated cleanup script
./.devcontainer/cleanup-devpod.sh

# Or run specific cleanup operations
./.devcontainer/cleanup-devpod.sh --docker-only
./.devcontainer/cleanup-devpod.sh --workspace-only
```

#### Manual Cleanup
```bash
# Clean Docker resources
docker system prune -af
docker volume prune -f
docker builder prune -af

# Check disk space
df -h

# Clean npm cache
npm cache clean --force

# Remove node_modules
rm -rf node_modules
```

#### Increase VM Resources
Add or update resource limits in `devcontainer.json`:
```json
{
  "customizations": {
    "devpod": {
      "resources": {
        "disk": "20Gi",    // Increase disk space
        "memory": "4Gi",   // Increase memory
        "cpu": "2"         // Increase CPU cores
      }
    }
  }
}
```

### 2. Permission Issues

**Symptoms:**
- `error parsing workspace info: rerun as root: exit status 1`
- Permission denied errors

**Solutions:**

#### Fix Container Permissions
```bash
# Inside the container
sudo chown -R vscode:vscode /workspace
sudo chmod -R 755 /workspace
```

#### Update devcontainer.json
Ensure proper user configuration:
```json
{
  "remoteUser": "vscode",
  "containerUser": "vscode",
  "updateRemoteUserUID": true
}
```

### 3. DevPod Provider Issues

**Check Provider Status:**
```bash
# List DevPod providers
devpod provider list

# Check provider status
devpod provider use <provider-name>

# Reset provider if needed
devpod provider delete <provider-name>
devpod provider add <provider-name>
```

### 4. Network/Connectivity Issues

**Solutions:**
```bash
# Check network connectivity
ping google.com

# Reset Docker network
docker network prune -f

# Restart Docker daemon (if accessible)
sudo systemctl restart docker
```

### 5. Image Build Failures

**Optimize Dockerfile:**
- Use smaller base images (e.g., `node:18-slim` instead of `ubuntu:22.04`)
- Combine RUN commands to reduce layers
- Use `.dockerignore` to exclude unnecessary files
- Clean up package caches in the same RUN command

**Example optimized Dockerfile layer:**
```dockerfile
RUN apt-get update && apt-get install -y \
    curl git vim \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/* \
    && rm -rf /var/tmp/*
```

## Prevention Strategies

### 1. Resource Monitoring
```bash
# Check disk usage regularly
df -h

# Monitor Docker resource usage
docker system df

# Check memory usage
free -h
```

### 2. Regular Cleanup
```bash
# Schedule regular cleanup (add to cron or run manually)
docker system prune -f
npm cache clean --force
```

### 3. Optimize Development Workflow
- Use `.dockerignore` to exclude unnecessary files
- Minimize the number of packages installed in the container
- Use multi-stage builds for production images
- Cache dependencies appropriately

## Emergency Recovery

### Complete Reset
```bash
# Stop all DevPod workspaces
devpod stop --all

# Delete problematic workspace
devpod delete <workspace-name>

# Clean all Docker resources
docker system prune -af --volumes

# Restart DevPod
devpod up
```

### Provider Reset
```bash
# Delete and recreate provider
devpod provider delete <provider-name>
devpod provider add <provider-name> --option <key>=<value>
```

## Getting Help

### Diagnostic Information
```bash
# Get DevPod version and status
devpod version
devpod list

# Check Docker status
docker version
docker info

# System information
df -h
free -h
uname -a
```

### Log Collection
```bash
# DevPod logs
devpod logs <workspace-name>

# Docker logs
docker logs <container-id>

# System logs (if accessible)
journalctl -u docker.service
```

## Configuration Files Reference

### devcontainer.json Key Settings
```json
{
  "build": {
    "dockerfile": "Dockerfile"
  },
  "remoteUser": "vscode",
  "containerUser": "vscode",
  "updateRemoteUserUID": true,
  "customizations": {
    "devpod": {
      "resources": {
        "disk": "20Gi",
        "memory": "4Gi",
        "cpu": "2"
      }
    }
  }
}
```

### .dockerignore Essential Entries
```
node_modules/
.git/
dist/
build/
.env*
*.log
coverage/
.cache/
```

## Contact and Support

- DevPod Documentation: https://devpod.sh/docs
- GitHub Issues: https://github.com/loft-sh/devpod/issues
- Community Slack: https://slack.loft.sh/