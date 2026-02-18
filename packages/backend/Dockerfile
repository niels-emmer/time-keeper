# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

# Enable Yarn 4
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

# Install all workspace deps (needed to build shared)
RUN yarn install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# Build shared first, then backend
RUN yarn workspace @time-keeper/shared tsc --noEmit || true
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

# Copy compiled output and migrations
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/shared/src ./packages/shared/src
COPY --from=builder /app/packages/backend/drizzle ./packages/backend/drizzle

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_PATH=/data/time-keeper.db

CMD ["node", "packages/backend/dist/index.js"]
