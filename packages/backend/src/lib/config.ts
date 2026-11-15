import { randomBytes } from 'crypto';

/**
 * Startup configuration (A5).
 *
 * Three things are validated before the server binds a port:
 *
 *   1. `AUTH_MODE` is a known value (`local` | `proxy` | `hybrid`).
 *   2. In production, the secrets the auth subsystem needs actually exist:
 *      `INTERNAL_PROXY_SECRET` (the existing proxy-header gate),
 *      `SESSION_SECRET` and `MFA_ENCRYPTION_KEY` (new in Phase A).
 *   3. Outside production, missing secrets are generated ephemerally and
 *      announced loudly, so a development run never silently depends on a
 *      placeholder that would be catastrophic in production.
 *
 * The failure mode is deliberate: a production instance with a missing or
 * short secret refuses to boot rather than running with a weak or empty key.
 *
 * `AUTH_MODE` defaults to `proxy` for Phase A: local login does not exist yet,
 * so the only honest default is the mode the app actually runs today. Phase F
 * flips the default to `local` when the login path is live (plan §2b, D1).
 */

export type AuthMode = 'local' | 'proxy' | 'hybrid';

const AUTH_MODES: readonly AuthMode[] = ['local', 'proxy', 'hybrid'];

/** Phase A default. Phase F changes this to 'local'. */
export const DEFAULT_AUTH_MODE: AuthMode = 'proxy';

export const MIN_SESSION_SECRET_LENGTH = 32;
export const MFA_KEY_BYTES = 32;

export function getAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  const raw = (env.AUTH_MODE ?? '').trim().toLowerCase();
  if (raw === '') {
    return DEFAULT_AUTH_MODE;
  }

  if ((AUTH_MODES as readonly string[]).includes(raw)) {
    return raw as AuthMode;
  }

  throw new Error(
    `AUTH_MODE must be one of ${AUTH_MODES.join(', ')} (got "${env.AUTH_MODE}")`
  );
}

/** True when the session/cookie path is active. */
export function modeAllowsSessions(mode: AuthMode): boolean {
  return mode === 'local' || mode === 'hybrid';
}

/** True when the Authentik header path is active. */
export function modeAllowsProxyHeaders(mode: AuthMode): boolean {
  return mode === 'proxy' || mode === 'hybrid';
}

export interface StartupConfig {
  authMode: AuthMode;
  sessionSecret: string;
  mfaEncryptionKey: Buffer;
}

function decodeKey(raw: string): Buffer | null {
  const trimmed = raw.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  try {
    const buffer = Buffer.from(trimmed, 'base64');
    return buffer.length === MFA_KEY_BYTES ? buffer : null;
  } catch {
    return null;
  }
}

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production';
}

/**
 * The 32-byte MFA key this process uses, resolved on demand.
 *
 * `validateStartupConfig()` runs before the server binds a port, but modules
 * that encrypt (or decrypt) a TOTP secret also need the key later, and tests
 * import those modules directly without booting the server. One resolver means
 * both paths read the same value and the development fallback is generated once
 * and written back to `env` rather than being regenerated per call.
 */
export function resolveMfaEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const existing = env.MFA_ENCRYPTION_KEY ? decodeKey(env.MFA_ENCRYPTION_KEY) : null;
  if (existing) {
    return existing;
  }

  if (isProduction(env)) {
    throw new Error(
      'MFA_ENCRYPTION_KEY must be set in production (32 bytes, base64 or hex; generate one with: openssl rand -base64 32)'
    );
  }

  const generated = randomBytes(MFA_KEY_BYTES);
  env.MFA_ENCRYPTION_KEY = generated.toString('base64');
  return generated;
}

/**
 * Validate the environment and resolve the secrets the process will use.
 *
 * Mutates `env` in the non-production case only, so that modules reading
 * `process.env.SESSION_SECRET` later in the same process see the generated
 * value. Throws in production when anything required is missing or malformed.
 */
export function validateStartupConfig(
  env: NodeJS.ProcessEnv = process.env,
): StartupConfig {
  const authMode = getAuthMode(env);

  if (isProduction(env)) {
    const problems: string[] = [];

    // Only required when the Authentik header path is actually reachable. A
    // `local` deployment has no proxy in front of it and does not need the
    // header gate, so demanding the secret there would be cargo cult.
    if (modeAllowsProxyHeaders(authMode) && !env.INTERNAL_PROXY_SECRET) {
      problems.push(
        'INTERNAL_PROXY_SECRET must be set in production when AUTH_MODE allows proxy headers (proxy | hybrid)'
      );
    }

    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < MIN_SESSION_SECRET_LENGTH) {
      problems.push(
        `SESSION_SECRET must be set in production and at least ${MIN_SESSION_SECRET_LENGTH} characters (generate one with: openssl rand -base64 48)`
      );
    }

    const mfaKey = env.MFA_ENCRYPTION_KEY ? decodeKey(env.MFA_ENCRYPTION_KEY) : null;
    if (!env.MFA_ENCRYPTION_KEY) {
      problems.push(
        'MFA_ENCRYPTION_KEY must be set in production (32 bytes, base64 or hex; generate one with: openssl rand -base64 32)'
      );
    } else if (!mfaKey) {
      problems.push(
        'MFA_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or hex)'
      );
    }

    if (problems.length > 0) {
      throw new Error(`Invalid production configuration:\n  - ${problems.join('\n  - ')}`);
    }

    return {
      authMode,
      sessionSecret: env.SESSION_SECRET as string,
      mfaEncryptionKey: mfaKey as Buffer,
    };
  }

  // Non-production: generate what is missing, and say so where a human will
  // see it. Tests get ephemeral values without noise.
  const warnings: string[] = [];

  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < MIN_SESSION_SECRET_LENGTH) {
    env.SESSION_SECRET = randomBytes(48).toString('base64');
    warnings.push('SESSION_SECRET was missing or too short — generated an ephemeral one');
  }

  let mfaKey = env.MFA_ENCRYPTION_KEY ? decodeKey(env.MFA_ENCRYPTION_KEY) : null;
  if (!mfaKey) {
    mfaKey = randomBytes(MFA_KEY_BYTES);
    env.MFA_ENCRYPTION_KEY = mfaKey.toString('base64');
    warnings.push('MFA_ENCRYPTION_KEY was missing or malformed — generated an ephemeral one');
  }

  if (warnings.length > 0 && env.NODE_ENV !== 'test') {
    console.warn(
      [
        '',
        '  ────────────────────────────────────────────────────────────────',
        '  DEVELOPMENT CONFIGURATION — NOT FOR PRODUCTION',
        ...warnings.map((warning) => `  • ${warning}`),
        '  Ephemeral secrets change on every restart: sessions and encrypted',
        '  MFA secrets will not survive a restart. Set them explicitly to keep',
        '  state across restarts.',
        '  ────────────────────────────────────────────────────────────────',
        '',
      ].join('\n')
    );
  }

  return { authMode, sessionSecret: env.SESSION_SECRET, mfaEncryptionKey: mfaKey };
}
