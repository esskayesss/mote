FROM oven/bun:1.3.11 AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/logging/package.json packages/logging/package.json
COPY packages/models/package.json packages/models/package.json
COPY packages/whisper-client/package.json packages/whisper-client/package.json

RUN bun install --frozen-lockfile

COPY . .

RUN bun run --cwd apps/backend build

FROM oven/bun:1.3.11 AS runtime
WORKDIR /app

COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/packages ./packages

RUN mkdir -p /data

ENV NODE_ENV=production
ENV DATABASE_PATH=/data/mote.sqlite

EXPOSE 3001

CMD ["bun", "apps/backend/dist/index.js"]
