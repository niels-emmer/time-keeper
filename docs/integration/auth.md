# Auth Integration — oauth2-proxy + Authentik

## Architecture overview

```
Browser → SSL terminator → oauth2-proxy:4180 → frontend nginx:80 → backend:3001
                                ↓
                           Authentik OIDC
```

oauth2-proxy validates OIDC tokens with Authentik. If the user is authenticated, it forwards the request to the upstream (`frontend:80`) with the `X-Auth-Request-User` header set to the user's email or OIDC subject. The frontend nginx passes this header to the backend when proxying `/api/*` requests.

## Setting up Authentik

1. Log in to your Authentik admin panel.
2. Go to **Applications → Providers → Create**.
3. Choose **OAuth2/OpenID Connect Provider**.
4. Set:
   - **Name**: `time-keeper`
   - **Redirect URIs**: `https://timekeeper.yourdomain.com/oauth2/callback`
   - **Scopes**: `openid email profile`
   - **Client type**: Confidential
5. Note the **Client ID** and **Client Secret**.
6. Go to **Applications → Create** and link it to the provider.
7. Copy the **OpenID Configuration URL** from the provider — this is your `AUTHENTIK_ISSUER_URL` (without `/.well-known/openid-configuration`).

## Environment variables

| Variable | Description |
|----------|-------------|
| `AUTHENTIK_ISSUER_URL` | OIDC issuer URL (e.g. `https://auth.example.com/application/o/time-keeper/`) |
| `OAUTH2_CLIENT_ID` | From Authentik provider settings |
| `OAUTH2_CLIENT_SECRET` | From Authentik provider settings |
| `OAUTH2_COOKIE_SECRET` | Random 32-byte base64 string (`openssl rand -base64 32`) |
| `APP_URL` | Public URL of the app (e.g. `https://timekeeper.example.com`) |

## Header contract

oauth2-proxy sets these headers on authenticated requests:

| Header | Value |
|--------|-------|
| `X-Auth-Request-User` | User email (used as `user_id` in the database) |
| `X-Auth-Request-Email` | Same as above for most Authentik setups |

The backend reads `X-Auth-Request-User` in `packages/backend/src/middleware/auth.ts`. **This header must be forwarded by nginx** — see `packages/frontend/nginx.conf`.

## Testing auth locally

In development, auth is bypassed entirely. The backend reads `DEV_USER_ID` from the environment:

```bash
DEV_USER_ID=you@example.com yarn workspace @time-keeper/backend dev
```

All categories and entries created in dev will be stored under that user ID.

## Troubleshooting

**oauth2-proxy redirect loop**: Verify `APP_URL` matches the redirect URI registered in Authentik exactly, including protocol and trailing slash.

**401 from backend despite being logged in**: Check that nginx is forwarding the `X-Auth-Request-User` header. Look for `proxy_set_header X-Auth-Request-User $http_x_auth_request_user;` in `nginx.conf`.

**"Error fetching OIDC configuration"**: The `AUTHENTIK_ISSUER_URL` must be the base OIDC URL, not the full `.well-known` URL. oauth2-proxy appends `/.well-known/openid-configuration` automatically.
