# Sandbox for harness workers (Tier A). Built and verified by `python3 -m harness isolation build|verify`.
FROM node:22-slim

# Pinned toolchain. Godot checksums are the official SHA512 values for 4.7.2-stable (see install_godot.py);
# GUT is pinned to a commit so `git` itself proves the checkout. Change these deliberately, then rebuild
# the image and rerun `harness isolation verify`, which the Tier A attestation depends on.
ARG GDTOOLKIT_VERSION=4.5.0
ARG GUT_COMMIT=c80954f47bed74a0a2c471d472c0389f98e0a8f6
ARG TARGETARCH

# PLAYWRIGHT_BROWSERS_PATH keeps Chromium outside the worker's home, which is a tmpfs at run time.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
    NODE_PATH=/usr/local/lib/node_modules

# libfontconfig1 is the only shared library the Godot binary loads eagerly; the X11, GL, and audio
# drivers are only opened by display drivers, and workers run headless.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git python3 python3-pip ca-certificates libfontconfig1 \
    && npm install -g @github/copilot@1.0.103 playwright@1.64.1 \
    && npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && npm cache clean --force

# GDScript linting and formatting (QA7): gdlint and gdformat, pinned.
RUN pip3 install --no-cache-dir --break-system-packages "gdtoolkit==${GDTOOLKIT_VERSION}" \
    && rm -rf /root/.cache/pip

# The Godot editor binary, used headless only. Export templates and the Android SDK stay out of the
# image: Android builds are a human-owned release workflow.
COPY install_godot.py /opt/harness/install_godot.py
RUN arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
    && python3 /opt/harness/install_godot.py "$arch" \
    && ln -sf /opt/godot/godot /usr/local/bin/godot \
    && godot --headless --version

# GUT 9 is the headless test runner. It is baked in and copied next to a throwaway project copy by
# /usr/local/bin/godot-test, so the repository never vendors third-party test code.
RUN git clone --depth 1 --branch v9.6.1 https://github.com/bitwes/Gut.git /tmp/gut \
    && test "$(git -C /tmp/gut rev-parse HEAD)" = "${GUT_COMMIT}" \
    && mkdir -p /opt/harness/godot/addons \
    && cp -a /tmp/gut/addons/gut /opt/harness/godot/addons/gut \
    && rm -rf /tmp/gut \
    && chmod -R a+rX /opt/harness/godot
COPY godot-test /opt/harness/godot-test
RUN chmod 0755 /opt/harness/godot-test && ln -sf /opt/harness/godot-test /usr/local/bin/godot-test

# Trusted browser and engine checks. Workers cannot change them: they live in the image, not in the repository.
COPY smoke/ /opt/harness/smoke/
RUN chmod 0755 /opt/harness/smoke/godot_project.sh

RUN useradd --uid 10001 --create-home --shell /bin/sh worker
USER worker
ENV HOME=/home/worker
WORKDIR /work
