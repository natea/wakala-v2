# Use a smaller Node.js base image instead of Ubuntu
FROM mcr.microsoft.com/devcontainers/node:18

# Avoid prompts from apt
ENV DEBIAN_FRONTEND=noninteractive

# Install essential packages in a single layer to reduce image size
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    vim \
    nano \
    tree \
    jq \
    build-essential \
    ca-certificates \
    gnupg \
    lsb-release \
    software-properties-common \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/* \
    && rm -rf /var/tmp/*

# Set the default user
USER vscode

# Set working directory
WORKDIR /workspace

# Reset DEBIAN_FRONTEND
ENV DEBIAN_FRONTEND=dialog