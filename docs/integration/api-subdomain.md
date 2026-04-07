# API Subdomain Setup (`api.*`)

This guide explains how to set up the separate API subdomain used by the macOS status bar app. The subdomain proxies directly to the backend **without** Authentik forward auth; the backend validates the Bearer token itself.

## Why a separate subdomain?

The main domain (`timekeeper.yourdomain.com`) runs through Authentik's forward-auth proxy, which is browser-session-based. Native apps cannot participate in that flow. The `api.*` subdomain exposes the same backend directly, protected by a per-user API token.

```
Native app → https://api.timekeeper.yourdomain.com → NPM (TLS only, proxy-net) → backend:3001 → Bearer token check
Browser    → https://timekeeper.yourdomain.com    → NPM (TLS + Authentik, proxy-net) → frontend:80/nginx → backend:3001 → X-authentik-email
```

Both NPM and the Time Keeper containers share the external `proxy-net` Docker network. No host ports are published — all traffic stays inside Docker.

## Prerequisites

- The main Time Keeper deployment is already running
- NPM (Nginx Proxy Manager) is in place and on the same Docker network as Time Keeper (`proxy-net`)
- A DNS A/CNAME record for `api.timekeeper.yourdomain.com` pointing to your server

## Step 1 — Deploy

No port changes needed. Both services communicate via the shared `proxy-net` Docker network:

```bash
APP_VERSION=$(git describe --tags --abbrev=0) docker compose up -d --build
```

## Step 2 — Create the NPM proxy host

In Nginx Proxy Manager:

1. **Add Proxy Host**
2. **Domain Names**: `api.timekeeper.yourdomain.com`
3. **Forward Hostname / IP**: `backend` (the Docker service name — resolved via Docker DNS on `proxy-net`)
4. **Forward Port**: `3001`
5. **Cache Assets**: off
6. **Block Common Exploits**: on

**SSL tab:**
- Request a Let's Encrypt certificate
- Force SSL: on
- HTTP/2 Support: on
- HSTS Enabled: on (recommended)

> **Important — do NOT add Authentik forward auth** to this proxy host. Leave the "Access List" empty and do not paste the Authentik forward-auth block into Advanced.

**Advanced tab — required security config:**

```nginx
# Strip any Authentik identity headers the client may have injected.
# Without this, an attacker could forge X-authentik-email and bypass token auth entirely.
proxy_set_header X-authentik-email    "";
proxy_set_header X-authentik-username "";
proxy_set_header X-authentik-uid      "";
proxy_set_header X-authentik-groups   "";
proxy_set_header X-authentik-name     "";
```

This is **not optional**. The backend trusts `X-authentik-email` for the main (Authentik-protected) domain; without stripping it here, any client can forge that header and gain full access without a token.

## Step 3 — Create a personal access token

Log in to the web app, go to **Settings → Personal Access Tokens**, and click **New token**.

Give it a descriptive label (e.g. "macOS app") and copy the token immediately — it is shown only once.

## Step 4 — Configure the macOS app

On first launch, enter:
- **API URL**: `https://api.timekeeper.yourdomain.com`
- **Access token**: the token you just created

The app will test the connection before saving.

## Security considerations

| Risk | Mitigation |
|------|-----------|
| Token stolen in transit | HTTPS enforced; NPM terminates TLS before the backend |
| Token brute-forced | 256-bit entropy (43-char base64url); rate-limiting applies (120 req/min) |
| Token stolen from device | Stored in macOS Keychain (not in plain text); revoke from web app immediately |
| Compromised token creates new tokens | Token management endpoints (`/api/tokens/*`) require Authentik header auth — a Bearer token cannot create or list tokens |
| Backend exposed on network | Backend is on `proxy-net` Docker network — reachable by NPM and other containers on that network, but not from the host or LAN directly (no published ports) |

## Revoking a token

In the web app, go to **Settings → Personal Access Tokens** and click the revoke (trash) icon next to the token. The token is invalidated immediately.

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| App shows "grey icon" / connection error | Wrong API URL, or NPM not on the same `proxy-net` Docker network as the backend |
| App shows "Invalid or expired token" (red) | Token was revoked, or wrong token entered |
| `curl -H "Authorization: Bearer <token>" https://api.timekeeper.yourdomain.com/api/health` returns `{"status":"ok"}` but app still fails | Check the token — health check doesn't require auth; try `/api/info` instead |
| NPM logs show 502 | Backend container is down or port binding incorrect |
