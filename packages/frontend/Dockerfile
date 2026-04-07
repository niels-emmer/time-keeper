# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

RUN yarn install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/frontend ./packages/frontend

# Build shared first so dist/ exists for Vite's module resolution
RUN yarn workspace @time-keeper/shared build
RUN yarn workspace @time-keeper/frontend build

# ---- Runtime stage ----
FROM nginx:alpine AS runtime

COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

# Place config in /etc/nginx/templates/ — the official nginx image's entrypoint
# runs envsubst on *.template files and writes the result to /etc/nginx/conf.d/
# at container startup. This expands ${INTERNAL_PROXY_SECRET} from the environment.
COPY packages/frontend/nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 80
