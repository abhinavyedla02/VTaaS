# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/
COPY worker/package.json worker/
RUN npm ci --workspace=worker --workspace=@vtaas/db
COPY packages/db/ packages/db/
RUN npm run generate --workspace=@vtaas/db
RUN npm run build --workspace=@vtaas/db
COPY worker/tsconfig.json worker/
COPY worker/src/ worker/src/
RUN npm run build --workspace=worker

# ---------- runtime stage ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# FFmpeg (D-014) — required for video transcoding
RUN apk add --no-cache ffmpeg

COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/
COPY worker/package.json worker/
RUN npm ci --omit=dev --workspace=worker --workspace=@vtaas/db
COPY packages/db/ packages/db/
RUN npm run generate --workspace=@vtaas/db
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/worker/dist ./worker/dist

# Healthcheck: verify ffmpeg is available (D-014)
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD ffmpeg -version > /dev/null 2>&1 || exit 1

CMD ["node", "worker/dist/main.js"]
