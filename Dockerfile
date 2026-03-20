# Stage 1: Build
FROM public.ecr.aws/docker/library/node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/

RUN npm ci --workspace=packages/shared --workspace=packages/backend

COPY packages/shared/ packages/shared/

# Build shared (generates skills.ts from .md files, then compiles)
RUN npm run build -w packages/shared

COPY packages/backend/ packages/backend/
RUN npm run build -w packages/backend

# Stage 2: Production
FROM public.ecr.aws/docker/library/node:20-alpine

WORKDIR /app
COPY --from=builder /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/shared/dist packages/shared/dist/
COPY --from=builder /app/packages/backend/package.json packages/backend/
COPY --from=builder /app/packages/backend/dist packages/backend/dist/

RUN npm ci --workspace=packages/shared --workspace=packages/backend --omit=dev

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "packages/backend/dist/index.js"]
