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
COPY packages/backend/docker-entrypoint.sh ./packages/backend/
COPY .git ./.git

# Extract version from git tag (or use 'dev' if not available)
RUN if [ -d .git ]; then \
      git describe --tags --abbrev=0 2>/dev/null > /version.txt || echo "dev" > /version.txt; \
    else \
      echo "dev" > /version.txt; \
    fi && \
    cat /version.txt

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
COPY --from=builder /version.txt /app/VERSION
COPY --from=builder /app/packages/backend/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_PATH=/data/time-keeper.db

ENTRYPOINT ["/app/docker-entrypoint.sh"]
