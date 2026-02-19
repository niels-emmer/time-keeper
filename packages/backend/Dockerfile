# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

# Enable Yarn 4
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

# Install all workspace deps
RUN yarn install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# Build shared (emits to packages/shared/dist/), then backend
RUN yarn workspace @time-keeper/shared build
RUN yarn workspace @time-keeper/backend build

# ---- Runtime stage ----
FROM node:22-alpine AS runtime

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

# Install only production deps
RUN yarn workspaces focus @time-keeper/backend --production

# Copy compiled output from builder
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/drizzle ./packages/backend/drizzle

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_PATH=/data/time-keeper.db

# Baked in at build time via: --build-arg APP_VERSION=$(git describe --tags --abbrev=0)
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

CMD ["node", "packages/backend/dist/index.js"]
