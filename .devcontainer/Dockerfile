# Use a smaller Node.js base image instead of Ubuntu
FROM node:18-slim

# Avoid prompts from apt
ENV DEBIAN_FRONTEND=noninteractive

# Create vscode user with sudo privileges
RUN groupadd --gid 1000 vscode \
    && useradd --uid 1000 --gid vscode --shell /bin/bash --create-home vscode \
    && apt-get update \
    && apt-get install -y sudo \
    && echo vscode ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/vscode \
    && chmod 0440 /etc/sudoers.d/vscode

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