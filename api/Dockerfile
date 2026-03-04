# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/
COPY api/package.json api/
RUN npm ci --workspace=api --workspace=@vtaas/db
COPY packages/db/ packages/db/
RUN npm run generate --workspace=@vtaas/db
COPY api/tsconfig.json api/
COPY api/src/ api/src/
RUN npm run build --workspace=api

# ---------- runtime stage ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/
COPY api/package.json api/
RUN npm ci --omit=dev --workspace=api --workspace=@vtaas/db
COPY packages/db/ packages/db/
RUN npm run generate --workspace=@vtaas/db
COPY --from=build /app/api/dist ./api/dist
EXPOSE 3000
CMD ["node", "api/dist/main.js"]
