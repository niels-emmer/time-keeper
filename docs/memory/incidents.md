# Incidents Log — Time Keeper

Record root causes and permanent learnings here. This helps avoid repeating the same mistakes.

**Template:**
```
## INC-NNN: Short title
Date: YYYY-MM-DD
Symptom: What the user observed
Root cause: The actual cause
Fix: What was changed
Learning: What to watch out for next time
```

---

## INC-001: Backend container crashes with ERR_MODULE_NOT_FOUND for shared package

Date: 2026-02
Symptom: `docker compose up` succeeded but the backend container immediately exited with `Cannot find module '/app/packages/shared/src/types/category.js'`.
Root cause: The backend Dockerfile was copying raw `.ts` source from `packages/shared/` into the runtime image. Node ESM cannot execute TypeScript files directly. The `shared` package had no build step and its `package.json` exports pointed at source files.
Fix:
- Added `"build": "tsc"` to `packages/shared/package.json`
- Changed `packages/shared/tsconfig.json` to use `module: NodeNext` so `tsc` emits `.js` files
- Updated `packages/shared/package.json` exports to point at `./dist/index.js`
- Updated the backend Dockerfile to run `yarn workspace @time-keeper/shared build` before the backend build, and copy `shared/dist/` into the runtime image
Learning: Any workspace package that is consumed at runtime (not just build time) must be compiled to JS. The `exports` field in `package.json` must point at `dist/`, not `src/`. Always verify this when adding a new shared package.

---

## INC-002: Frontend Docker build fails — cannot resolve @time-keeper/shared

Date: 2026-02
Symptom: `docker compose build frontend` failed with `[vite] Failed to resolve entry for package "@time-keeper/shared"`.
Root cause: The `shared` package's `dist/` directory is gitignored and therefore not present in the Docker build context. Vite tried to resolve the package's `exports` entry (`./dist/index.js`) during the build but the file didn't exist yet.
Fix: Added `RUN yarn workspace @time-keeper/shared build` to the frontend Dockerfile before the Vite build step.
Learning: Both Dockerfiles must explicitly build `@time-keeper/shared` before building their own package. The build context is the repo root, but `dist/` is gitignored — it must be generated inside the Docker build, not assumed to be present.

---

## INC-003: nginx "host not found in upstream backend" on startup

Date: 2026-02
Symptom: Frontend container started but immediately logged `[emerg] host not found in upstream "backend"` and exited.
Root cause: nginx resolves `proxy_pass` hostnames at startup, not at request time. When the `app` network was missing from `docker-compose.yml` (or the containers were on different networks), Docker's internal DNS had no `backend` entry at the time nginx started.
Fix:
- Added `resolver 127.0.0.11 valid=30s;` (Docker's embedded DNS resolver) to `nginx.conf`
- Changed the proxy_pass directive to use a variable: `set $backend_upstream http://backend:3001; proxy_pass $backend_upstream;` — this defers DNS resolution to request time
Learning: Always use the variable pattern for `proxy_pass` in Docker nginx configs. Static hostnames in `proxy_pass` are resolved once at startup and will fail if the upstream isn't resolvable at that moment. Also: never manually edit `networks:` out of `docker-compose.yml` — it breaks inter-service DNS.

---

## INC-004: express-rate-limit ERR_ERL_UNEXPECTED_X_FORWARDED_FOR

Date: 2026-02
Symptom: All API requests returned 500; backend logs showed `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.
Root cause: `express-rate-limit` detected an `X-Forwarded-For` header but Express was not configured to trust the reverse proxy chain. Without `trust proxy`, Express treats the header as potentially spoofed and throws.
Fix: Added `app.set('trust proxy', 1)` to `app.ts` before the rate limiter is mounted.
Learning: Any Express app behind a reverse proxy (nginx, NPM, Caddy, etc.) must set `trust proxy`. Add it as the first line of `createApp()` — it affects rate limiting, `req.ip`, and any other code that reads forwarded headers.

---

## INC-005: 401 Unauthorized despite successful Authentik login

Date: 2026-02
Symptom: App loaded, Authentik login succeeded and redirected back, but every API call returned 401.
Root cause: The auth middleware was reading `X-Forwarded-Email` (the header set by a standalone oauth2-proxy) but Authentik's embedded outpost sets `X-authentik-email` (lowercase, with the `authentik-` prefix). The NPM forward auth template uses `auth_request_set $authentik_email $upstream_http_x_authentik_email` and then `proxy_set_header X-authentik-email $authentik_email`.
Fix:
- Changed auth middleware to read `req.headers['x-authentik-email']`
- Updated `nginx.conf` to forward `X-authentik-*` headers (not `X-Forwarded-*`)
- Updated `invariants.md` and all docs to reference the correct header name
Learning: Authentik's **embedded outpost** sets `X-authentik-*` headers. Authentik's **standalone outpost** and generic oauth2-proxy set `X-Forwarded-*` headers. These are different. Always verify which outpost type you're using and check the actual NPM Advanced config to see which headers are being set.

---

## INC-006: 502 Bad Gateway — NPM cannot reach frontend via LAN IP

Date: 2026-02-19
Symptom: App returned 502 after rebuild. `curl http://127.0.0.1:38521/api/health` worked fine from the host. `wget http://backend:3001/api/health` worked from inside the frontend container.
Root cause: `docker-compose.yml` bound the frontend port to `127.0.0.1:38521` (loopback only). NPM runs in Docker and reaches services via the server's LAN IP (192.168.101.252), not loopback — so it could never connect.
Fix: Changed port binding from `"127.0.0.1:38521:80"` to `"38521:80"` in `docker-compose.yml`. Updated NPM proxy host to use `192.168.101.252:38521`.
Learning: When NPM (or any Docker-based reverse proxy) accesses services by LAN IP, the target port must be bound to `0.0.0.0` (all interfaces), not `127.0.0.1`. Use `"PORT:PORT"` not `"127.0.0.1:PORT:PORT"` in docker-compose.yml for services that NPM needs to reach.
