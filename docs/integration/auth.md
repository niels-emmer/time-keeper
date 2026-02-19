# Auth Integration — Authentik + Nginx Proxy Manager

## Architecture

```
Browser
  └── Nginx Proxy Manager (SSL termination + forward auth)
        └── Authentik embedded outpost (auth check)
        └── (authenticated) → frontend nginx:38521
                                   └── /api/* → backend:3001
                                                   └── reads X-authentik-email header
```

Auth is handled entirely outside the application code. NPM's forward auth integration with Authentik's embedded outpost validates sessions and injects identity headers. The app itself contains no auth logic — it only reads a header.

No client ID, client secret, or OIDC configuration is needed in this codebase.

## Headers the backend reads

Authentik's embedded outpost sets these headers on authenticated requests (as forwarded by the NPM proxy template):

| Header | Value | Used as |
|--------|-------|---------|
| `X-authentik-email` | User's email address | `userId` — stored with every DB record |
| `X-authentik-username` | Username | Passed through, not used |
| `X-authentik-uid` | OIDC `sub` (UUID) | Passed through, not used |

The backend auth middleware (`packages/backend/src/middleware/auth.ts`) reads `X-authentik-email`. All database queries filter by this value.

## Authentik setup

### Step 1: Create a Proxy Provider

1. Authentik Admin → **Applications → Providers → Create**
2. Choose **Proxy Provider**
3. Fill in:
   - **Name:** `time-keeper`
   - **Authorization flow:** your default (e.g. `default-provider-authorization-implicit-consent`)
   - **Mode:** Forward auth (single application)
   - **External host:** `https://timekeeper.yourdomain.com`
4. Save

### Step 2: Create an Application

1. **Applications → Applications → Create**
2. Fill in:
   - **Name:** `Time Keeper`
   - **Slug:** `time-keeper`
   - **Provider:** `time-keeper`
3. Save

### Step 3: Add to your outpost

1. **Applications → Outposts**
2. Edit your existing proxy outpost
3. Add `Time Keeper` to the selected applications
4. Save — the outpost reconfigures within a few seconds

## Nginx Proxy Manager setup

### Proxy host

1. **Proxy Hosts → Add Proxy Host**
2. **Details tab:**
   - Domain: `timekeeper.yourdomain.com`
   - Scheme: `http`
   - Forward Hostname/IP: `127.0.0.1`
   - Forward Port: `38521`
   - Websockets Support: on
3. **SSL tab:** select or request your certificate, force SSL on
4. **Advanced tab:** paste the Authentik NPM template (see below)

### NPM Advanced config

Use the standard Authentik NPM proxy template. The key section that sets identity headers:

```nginx
auth_request_set $authentik_email $upstream_http_x_authentik_email;
proxy_set_header X-authentik-email $authentik_email;
```

The full template is available in the Authentik documentation and in your existing protected proxy hosts — copy it from there. Replace the outpost `proxy_pass` URL with your Authentik instance:

```nginx
location /outpost.goauthentik.io {
    proxy_pass http://<your-authentik-host>:9000/outpost.goauthentik.io;
    ...
}
```

## Development (no auth)

Auth is skipped entirely in dev mode. The backend reads `DEV_USER_ID` from the environment:

```bash
DEV_USER_ID=you@example.com yarn workspace @time-keeper/backend dev
```

All data is stored under this value. No Authentik setup needed locally.

## Troubleshooting

**401 from the backend after successful Authentik login**
The `X-authentik-email` header isn't reaching the backend. Check in order:
1. The NPM Advanced config sets `proxy_set_header X-authentik-email $authentik_email`
2. The frontend nginx forwards it: `proxy_set_header X-authentik-email $http_x_authentik_email` in `packages/frontend/nginx.conf`
3. The outpost is healthy: Authentik Admin → Outposts → verify status

**Redirect loop after login**
The Proxy Provider's **External host** must exactly match the domain NPM is serving, including `https://`. Check the Proxy Provider settings in Authentik.

**500 on first load**
Usually means the outpost hasn't been assigned the application yet, or the outpost `proxy_pass` URL in the NPM Advanced config is wrong.
