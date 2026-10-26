# Sandbox for harness workers (Tier A). Built and verified by `python3 -m harness isolation build|verify`.
FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @github/copilot@1.0.103 \
    && npm cache clean --force

RUN useradd --uid 10001 --create-home --shell /bin/sh worker
USER worker
ENV HOME=/home/worker
WORKDIR /work
