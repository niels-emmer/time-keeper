# Auth Integration — Authentik Proxy Outpost + NPM

## Architecture overview

```
Browser
  └── Nginx Proxy Manager (SSL termination)
        └── Authentik forward auth check → Authentik outpost
        └── (if authenticated) → frontend nginx:8080
                                       └── /api/* → backend:3001
                                                       └── reads X-Forwarded-Email header
```

Auth is handled entirely outside the application. Authentik's proxy outpost sits between NPM and the app, sets identity headers on authenticated requests, and redirects unauthenticated users to the Authentik login page. No OIDC client ID or secret is needed in this codebase.

## Headers the backend reads

Authentik's outpost sets these on every authenticated request:

| Header | Value | Used by |
|--------|-------|---------|
| `X-Forwarded-Email` | User's email address | Backend `userId` — **primary** |
| `X-Forwarded-User` | OIDC `sub` (UUID) | Passed through, not used |
| `X-Forwarded-Preferred-Username` | Username | Passed through, not used |

The backend auth middleware (`packages/backend/src/middleware/auth.ts`) reads `X-Forwarded-Email` and sets it as `req.userId`. All DB queries filter by this value.

## Setting up in Authentik

### Step 1: Create a Proxy Provider

1. Authentik Admin → **Applications → Providers → Create**
2. Choose **Proxy Provider**
3. Fill in:
   - **Name:** `time-keeper`
   - **Authorization flow:** your default (e.g. `default-provider-authorization-implicit-consent`)
   - **Mode:** Forward auth (single application)
   - **External host:** `https://timekeeper.yourdomain.com`
4. Save — no client ID/secret needed for proxy providers

### Step 2: Create an Application

1. **Applications → Applications → Create**
2. Fill in:
   - **Name:** `Time Keeper`
   - **Slug:** `time-keeper`
   - **Provider:** `time-keeper` (the proxy provider above)
3. Save

### Step 3: Assign to the outpost

1. **Applications → Outposts**
2. Open your existing proxy outpost (the one already protecting your other apps)
3. Under **Applications**, add `Time Keeper`
4. Save — the outpost will reconfigure within a few seconds

## Setting up in Nginx Proxy Manager

### Proxy host

1. **Proxy Hosts → Add Proxy Host**
2. **Details tab:**
   - Domain: `timekeeper.yourdomain.com`
   - Scheme: `http`
   - Forward Hostname/IP: `127.0.0.1`
   - Forward Port: `38521`
   - Websockets: on (optional but harmless)
3. **SSL tab:** request or select your cert, force SSL on
4. **Advanced tab** — paste this custom nginx config:

```nginx
# Forward Authentik identity headers to the upstream
proxy_set_header X-Forwarded-Email $http_x_forwarded_email;
proxy_set_header X-Forwarded-User $http_x_forwarded_user;
proxy_set_header X-Forwarded-Preferred-Username $http_x_forwarded_preferred_username;
```

### Forward auth location

Back in the proxy host, go to **Advanced** and add:

```nginx
# Authentik forward auth
auth_request /outpost.goauthentik.io/auth/nginx;
error_page 401 = @goauthentik_proxy_signin;
http2_push_preload on;

# Pass response headers from Authentik to the upstream
auth_request_set $authentik_set_cookie $upstream_http_set_cookie;
add_header Set-Cookie $authentik_set_cookie;
auth_request_set $authentik_forwarded_email $upstream_http_x_forwarded_email;
proxy_set_header X-Forwarded-Email $authentik_forwarded_email;

location /outpost.goauthentik.io {
    proxy_pass https://authentik.yourdomain.com/outpost.goauthentik.io;
    proxy_set_header Host authentik.yourdomain.com;
    proxy_http_version 1.1;
    proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
    add_header Set-Cookie $auth_cookie;
    auth_request_set $auth_cookie $upstream_http_set_cookie;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
}

location @goauthentik_proxy_signin {
    internal;
    add_header Set-Cookie $authentik_set_cookie;
    return 302 /outpost.goauthentik.io/start?rd=$scheme://$http_host$request_uri;
}
```

Replace `authentik.yourdomain.com` with your Authentik hostname.

> **Note:** If you have other apps already protected by the same outpost in NPM, copy the forward auth block from one of those proxy hosts — it will be identical.

## Development (no auth)

In dev mode, the backend reads `DEV_USER_ID` from the environment:

```bash
DEV_USER_ID=you@example.com yarn workspace @time-keeper/backend dev
```

No Authentik or outpost configuration is needed locally.

## Troubleshooting

**401 from the backend despite being logged in**
The `X-Forwarded-Email` header is not reaching the backend. Check:
1. NPM Advanced config has the `proxy_set_header X-Forwarded-Email` line
2. The internal `nginx.conf` (in the frontend container) passes the header: look for `proxy_set_header X-Forwarded-Email $http_x_forwarded_email;` in `packages/frontend/nginx.conf`
3. The outpost is actually running: Authentik Admin → Outposts → check the outpost's health

**Redirect loop after login**
The outpost's **External host** must match the domain NPM is serving exactly, including protocol (`https://timekeeper.yourdomain.com`). Check this in the Proxy Provider settings.

**App works but shows someone else's data / wrong user**
Two `X-Forwarded-Email` values are arriving. Ensure the NPM advanced config only sets the header from `$authentik_forwarded_email` (the value returned by `auth_request_set`), not from a passthrough of whatever the browser sends.
