# Sandbox for harness workers (Tier A). Built and verified by `python3 -m harness isolation build|verify`.
FROM node:22-slim

# PLAYWRIGHT_BROWSERS_PATH keeps Chromium outside the worker's home, which is a tmpfs at run time.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
    NODE_PATH=/usr/local/lib/node_modules

RUN apt-get update \
    && apt-get install -y --no-install-recommends git python3 ca-certificates \
    && npm install -g @github/copilot@1.0.103 playwright@1.64.1 \
    && npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && npm cache clean --force

# Trusted browser checks. Workers cannot change them: they live in the image, not in the repository.
COPY smoke/ /opt/harness/smoke/

RUN useradd --uid 10001 --create-home --shell /bin/sh worker
USER worker
ENV HOME=/home/worker
WORKDIR /work
