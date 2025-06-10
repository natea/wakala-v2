#!/bin/bash

# DevPod Cleanup and Troubleshooting Script
# This script helps resolve disk space and permission issues with DevPod

set -e

echo "🧹 DevPod Cleanup and Troubleshooting Script"
echo "============================================="

# Function to check disk space
check_disk_space() {
    echo "📊 Checking disk space..."
    df -h
    echo ""
}

# Function to clean Docker resources
clean_docker() {
    echo "🐳 Cleaning Docker resources..."
    
    # Remove unused containers
    echo "Removing stopped containers..."
    docker container prune -f || true
    
    # Remove unused images
    echo "Removing unused images..."
    docker image prune -f || true
    
    # Remove unused volumes
    echo "Removing unused volumes..."
    docker volume prune -f || true
    
    # Remove unused networks
    echo "Removing unused networks..."
    docker network prune -f || true
    
    # Remove build cache
    echo "Removing build cache..."
    docker builder prune -f || true
    
    echo "Docker cleanup completed!"
    echo ""
}

# Function to clean DevPod workspace
clean_devpod_workspace() {
    echo "🗂️ Cleaning DevPod workspace..."
    
    # Clean npm cache if it exists
    if command -v npm &> /dev/null; then
        echo "Cleaning npm cache..."
        npm cache clean --force || true
    fi
    
    # Remove node_modules if it exists
    if [ -d "node_modules" ]; then
        echo "Removing node_modules..."
        rm -rf node_modules
    fi
    
    # Remove build artifacts
    echo "Removing build artifacts..."
    rm -rf dist/ build/ .next/ out/ || true
    
    echo "DevPod workspace cleanup completed!"
    echo ""
}

# Function to check DevPod status
check_devpod_status() {
    echo "🔍 Checking DevPod status..."
    
    if command -v devpod &> /dev/null; then
        echo "DevPod version:"
        devpod version || true
        echo ""
        
        echo "DevPod workspaces:"
        devpod list || true
        echo ""
    else
        echo "DevPod CLI not found"
        echo ""
    fi
}

# Function to fix permissions
fix_permissions() {
    echo "🔧 Fixing permissions..."
    
    # Fix ownership of workspace files
    if [ "$EUID" -eq 0 ]; then
        chown -R vscode:vscode /workspace || true
    else
        sudo chown -R vscode:vscode /workspace || true
    fi
    
    echo "Permissions fixed!"
    echo ""
}

# Main execution
main() {
    echo "Starting cleanup process..."
    echo ""
    
    check_disk_space
    check_devpod_status
    clean_docker
    clean_devpod_workspace
    fix_permissions
    
    echo "✅ Cleanup completed!"
    echo ""
    echo "💡 Tips to prevent future issues:"
    echo "  - Regularly run 'docker system prune' to clean unused resources"
    echo "  - Monitor disk space with 'df -h'"
    echo "  - Use .dockerignore to exclude unnecessary files from builds"
    echo "  - Consider increasing VM disk size if issues persist"
    echo ""
    
    check_disk_space
}

# Parse command line arguments
case "${1:-}" in
    --docker-only)
        clean_docker
        ;;
    --workspace-only)
        clean_devpod_workspace
        ;;
    --check-only)
        check_disk_space
        check_devpod_status
        ;;
    --help|-h)
        echo "Usage: $0 [--docker-only|--workspace-only|--check-only|--help]"
        echo ""
        echo "Options:"
        echo "  --docker-only     Clean only Docker resources"
        echo "  --workspace-only  Clean only workspace files"
        echo "  --check-only      Check status without cleaning"
        echo "  --help, -h        Show this help message"
        echo ""
        echo "Default: Run full cleanup process"
        ;;
    *)
        main
        ;;
esac