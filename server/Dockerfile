# ECS runs this image on linux/amd64. Keep both the tag and platform manifest
# digest so a rebuilt tag cannot change the build input.
FROM oven/bun:1.3.14@sha256:50317d83cd5a5ae1d8b35b3379c69f57ce1a0dbf4def91f0965653d767851834 AS dependencies

USER root
WORKDIR /app

# The lockfile is the only dependency-resolution input. Production-only
# dependencies are copied into the final image; no install happens at runtime.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14@sha256:50317d83cd5a5ae1d8b35b3379c69f57ce1a0dbf4def91f0965653d767851834 AS runtime

USER root
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000 \
    TMPDIR=/tmp \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    XDG_CONFIG_HOME=/tmp/.config \
    BUN_INSTALL_CACHE_DIR=/tmp/.bun/install/cache \
    NPM_CONFIG_CACHE=/tmp/.npm

# /app is copied as root-owned and is intentionally read-only to the runtime
# user. Libraries that need a temporary home or cache are confined to /tmp.
RUN chmod 1777 /tmp

COPY --chown=0:0 --from=dependencies /app/node_modules ./node_modules
COPY --chown=0:0 package.json bun.lock tsconfig.json ./
COPY --chown=0:0 src ./src

USER 10001:10001

EXPOSE 5000

CMD ["bun", "src/index.ts"]
