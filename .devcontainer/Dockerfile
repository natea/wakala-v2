# Use the official Ubuntu base image
FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

# Install additional packages if needed
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    vim \
    nano \
    tree \
    jq \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set the default user
USER vscode

# Set working directory
WORKDIR /workspace