/**
 * Password policy (Q22, plan §3).
 *
 *   * 12 characters minimum — length is the only requirement that reliably
 *     buys entropy, which is why there are no composition rules ("Password1!"
 *     satisfies every class rule and is still terrible).
 *   * No username or email substrings, so a leaked password list cannot be
 *     correlated with the account it belongs to.
 *   * A **local** denylist of the passwords that appear at the top of every
 *     breach corpus. There is deliberately no outbound call to a breach-check
 *     API: this app is self-hosted, and asking a third party to hash-check a
 *     user's password would be an egress path the operator never opted into.
 *
 * The same function is the single source of truth for invite acceptance and
 * password change, so the two cannot drift.
 */

export const PASSWORD_MIN_LENGTH = 12;
/** Bound the scrypt input; not a policy a human is expected to hit. */
export const PASSWORD_MAX_LENGTH = 1024;

/**
 * The most common passwords, lower-cased. Kept short on purpose: a denylist is
 * a speed bump for the obvious choices, not a substitute for length.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789012345',
  '1234567890',
  '123456789',
  '12345678',
  'qwertyuiop',
  'qwertyuiopasdf',
  'qwerty123456',
  'password1234',
  'password12345',
  'passwordpassword',
  'passw0rdpassw0rd',
  'letmeinletmein',
  'iloveyouiloveyou',
  'welcomewelcome',
  'administrator',
  'administrator1',
  'changemenow1',
  'correcthorsebatterystaple',
  'timekeepertimekeeper',
  'timekeeper123',
  'supermanbatman',
  'trustno1trustno1',
  'monkeymonkey',
  'dragondragon',
  'baseballbaseball',
  'footballfootball',
  'sunshinesunshine',
  'princessprincess',
  'shadowshadow',
  'mastermaster',
  'michaelmichael',
  'starwarsstarwars',
]);

export interface PasswordPolicyContext {
  username?: string | null;
  email?: string | null;
}

export type PasswordPolicyResult = { ok: true } | { ok: false; message: string };

function contains(haystack: string, needle: string | null | undefined): boolean {
  if (!needle) {
    return false;
  }

  const value = needle.trim().toLowerCase();
  // Short values ("a", "me") appear inside almost any password; they only
  // count as a leak if they are long enough to be meaningful.
  if (value.length < 3) {
    return false;
  }

  return haystack.includes(value);
}

/**
 * Check a candidate password. Returns a single human-readable reason on
 * failure — the messages are safe to render next to the field, and they never
 * echo the password back.
 */
export function checkPasswordPolicy(
  password: string,
  context: PasswordPolicyContext = {}
): PasswordPolicyResult {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
    };
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters long.`,
    };
  }

  const lowered = password.toLowerCase();

  if (contains(lowered, context.username)) {
    return { ok: false, message: 'Password must not contain your username.' };
  }

  const email = context.email?.trim().toLowerCase() ?? '';
  const emailLocalPart = email.includes('@') ? email.slice(0, email.indexOf('@')) : email;

  if (contains(lowered, email) || contains(lowered, emailLocalPart)) {
    return { ok: false, message: 'Password must not contain your email address.' };
  }

  if (COMMON_PASSWORDS.has(lowered)) {
    return {
      ok: false,
      message: 'That password is too common. Choose something less predictable.',
    };
  }

  // A single repeated character or a straight keyboard run is long but carries
  // almost no entropy.
  if (/^(.)\1+$/.test(lowered) || /^(0123456789|abcdefghijklmnopqrstuvwxyz|qwertyuiop)/.test(lowered)) {
    return {
      ok: false,
      message: 'That password is too predictable. Choose something less obvious.',
    };
  }

  return { ok: true };
}
