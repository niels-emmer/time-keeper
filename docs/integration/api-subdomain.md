# API Subdomain Setup (`api.*`)

This guide explains how to set up the separate API subdomain used by the macOS status bar app. The subdomain proxies directly to the backend **without** Authentik forward auth; the backend validates the Bearer token itself.

## Why a separate subdomain?

The main domain (`timekeeper.yourdomain.com`) runs through Authentik's forward-auth proxy, which is browser-session-based. Native apps cannot participate in that flow. The `api.*` subdomain exposes the same backend directly, protected by a per-user API token.

```
Native app → https://api.timekeeper.yourdomain.com → NPM (TLS only) → backend:38522 → Bearer token check
Browser    → https://timekeeper.yourdomain.com    → NPM (TLS + Authentik) → backend:38521/nginx → X-authentik-email
```

## Prerequisites

- The main Time Keeper deployment is already running
- NPM (Nginx Proxy Manager) is in place
- A DNS A/CNAME record for `api.timekeeper.yourdomain.com` pointing to your server
- Port 38522 is accessible from the NPM host (it is bound to `127.0.0.1:38522` on the server; if NPM runs on the same host, this is fine — if NPM is on a different host, change the port binding in `docker-compose.yml` to your server's LAN IP)

## Step 1 — Update docker-compose.yml

The backend already exposes port 38522 in the provided `docker-compose.yml`:

```yaml
ports:
  - "127.0.0.1:38522:3001"
```

Rebuild and restart:

```bash
APP_VERSION=$(git describe --tags --abbrev=0) docker compose up -d --build
```

## Step 2 — Create the NPM proxy host

In Nginx Proxy Manager:

1. **Add Proxy Host**
2. **Domain Names**: `api.timekeeper.yourdomain.com`
3. **Forward Hostname / IP**: `127.0.0.1` (or your server's LAN IP)
4. **Forward Port**: `38522`
5. **Cache Assets**: off
6. **Block Common Exploits**: on

**SSL tab:**
- Request a Let's Encrypt certificate
- Force SSL: on
- HTTP/2 Support: on
- HSTS Enabled: on (recommended)

> **Important — do NOT add Authentik forward auth** to this proxy host. Leave the "Access List" and "Advanced" Authentik forward-auth config completely empty. The backend handles authentication via the Bearer token.

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
| Backend exposed on LAN | Port bound to `127.0.0.1` — not reachable from other LAN devices; only the local NPM host can reach it |

## Revoking a token

In the web app, go to **Settings → Personal Access Tokens** and click the revoke (trash) icon next to the token. The token is invalidated immediately.

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| App shows "grey icon" / connection error | Wrong API URL, or port 38522 not reachable from NPM host |
| App shows "Invalid or expired token" (red) | Token was revoked, or wrong token entered |
| `curl -H "Authorization: Bearer <token>" https://api.timekeeper.yourdomain.com/api/health` returns `{"status":"ok"}` but app still fails | Check the token — health check doesn't require auth; try `/api/info` instead |
| NPM logs show 502 | Backend container is down or port binding incorrect |
