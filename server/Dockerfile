FROM oven/bun:1 AS dependencies

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS source

COPY src ./src
COPY tsconfig.json ./tsconfig.json

FROM oven/bun:1 AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=source /app/src ./src
COPY --from=source /app/tsconfig.json ./tsconfig.json

CMD ["bun", "src/index.ts"]
