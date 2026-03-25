FROM oven/bun:1.3.11 AS build
WORKDIR /app

ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

COPY package.json bun.lock ./
COPY apps/demo-frontend/package.json apps/demo-frontend/package.json
COPY packages/logging/package.json packages/logging/package.json
COPY packages/models/package.json packages/models/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN bun install --frozen-lockfile

COPY . .

RUN bun run --cwd apps/demo-frontend build

FROM nginx:1.27-alpine AS runtime

COPY apps/demo-frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/demo-frontend/dist /usr/share/nginx/html

EXPOSE 80
