FROM oven/bun:1.3.14 AS dependencies

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS source

COPY src ./src
COPY tsconfig.json ./tsconfig.json

FROM oven/bun:1.3.14 AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=source /app/src ./src
COPY --from=source /app/tsconfig.json ./tsconfig.json

USER bun

CMD ["bun", "src/index.ts"]
