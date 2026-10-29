# Cashier development container

FROM mcr.microsoft.com/devcontainers/typescript-node:4-24-trixie

COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /uvx /usr/local/bin/

# To install additional packages, add them to the list in the command below:
RUN apt-get update && apt-get install -y \
    ripgrep \
    python3 \
    && rm -rf /var/lib/apt/lists/*

    # mkcert \
    # libnss3-tools \

ENV PATH="/home/node/.local/bin:${PATH}"

USER node
RUN uv tool install --python /usr/bin/python3 serena-agent==2.1.0
USER root
