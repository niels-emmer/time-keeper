# Architecture Decision Log — Time Keeper

Short-form ADRs. Add new entries at the bottom.

---

## D-001: Drizzle ORM over Prisma

**Date:** 2026-02
**Status:** Accepted

Drizzle + better-sqlite3 was chosen over Prisma because:
- Drizzle has no binary query engine — simpler Docker builds, smaller images
- better-sqlite3 is synchronous, which matches SQLite's single-writer nature perfectly
- Drizzle schema is plain TypeScript — no separate `.prisma` DSL file
- Migrations are plain SQL files (committed in `drizzle/`) — fully auditable

## D-002: shadcn/ui + Tailwind CSS v3 over MUI/Chakra

**Date:** 2026-02
**Status:** Accepted

- shadcn/ui components are copied into the source tree — no dependency drift, no breaking upgrades from the library
- Tailwind provides consistent spacing/color without a runtime CSS-in-JS overhead
- Radix UI primitives (underlying shadcn/ui) are fully accessible
- Mobile-first design aligns well with the Android + macOS target
- Tailwind v3 chosen over v4: v4 ecosystem still maturing as of project start

## D-003: oauth2-proxy sidecar for authentication

**Date:** 2026-02
**Status:** Accepted

Instead of implementing OIDC in the Express backend:
- oauth2-proxy handles all token validation, session cookies, and OIDC flows
- The backend only reads an HTTP header — zero auth complexity in the app code
- Auth is enforced at the network level, not inside application logic
- Makes the backend trivially testable without a running Authentik instance

## D-004: user_id denormalized into all tables

**Date:** 2026-02
**Status:** Accepted

Every row in `categories` and `time_entries` has a `user_id TEXT` column. There is no `users` table. This is intentional:
- Authentik owns user creation/deletion — the app doesn't need to know
- Queries are simple `WHERE user_id = ?` filters
- No JOIN needed to enforce data ownership
- If a user is removed from Authentik, their data stays in DB but is inaccessible

## D-005: Active timer = entry with null end_time

**Date:** 2026-02
**Status:** Accepted

A running timer is represented as a `time_entries` row where `end_time IS NULL`. There is no separate `timers` table or state field. Stopping a timer = setting `end_time`. The single-timer invariant (I-003) is enforced by the service layer, not the DB schema.

## D-006: @tanstack/react-query for server state

**Date:** 2026-02
**Status:** Accepted

React Query provides:
- Automatic cache invalidation after mutations (stop timer → invalidate summary)
- Background refetching on window focus
- `refetchInterval: 5000` for the active timer query (keeps elapsed time fresh without manual polling code)
- Clean separation between server state (React Query) and local UI state (useState)
