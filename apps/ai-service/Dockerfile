FROM oven/bun:1.3.11 AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/ai-service/package.json apps/ai-service/package.json
COPY packages/logging/package.json packages/logging/package.json
COPY packages/models/package.json packages/models/package.json
COPY packages/whisper-client/package.json packages/whisper-client/package.json

RUN bun install --frozen-lockfile

COPY . .

RUN bun run --cwd apps/ai-service build

FROM oven/bun:1.3.11 AS runtime
WORKDIR /app

COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/ai-service/package.json ./apps/ai-service/package.json
COPY --from=build /app/apps/ai-service/dist ./apps/ai-service/dist
COPY --from=build /app/packages ./packages

ENV NODE_ENV=production

EXPOSE 3002

CMD ["bun", "apps/ai-service/dist/index.js"]
