/**
 * Password policy (Q22, plan §3) — the single source of truth for both the API
 * and the UI checklist.
 *
 *   * 12 characters minimum — length is the only requirement that reliably
 *     buys entropy, which is why there are no composition rules ("Password1!"
 *     satisfies every class rule and is still terrible).
 *   * No username or email substrings, so a leaked password list cannot be
 *     correlated with the account it belongs to.
 *   * A **local** denylist of the passwords that appear at the top of every
 *     breach corpus, plus a cheap "easily guessed" check for a single repeated
 *     character or a straight keyboard run. There is deliberately no outbound
 *     call to a breach-check API: this app is self-hosted, and asking a third
 *     party to hash-check a user's password would be an egress path the
 *     operator never opted into.
 *
 * The logic lives here, not in the backend, because the invite and reset forms
 * render the same rules as a live checklist. When the checklist was a separate
 * copy it silently omitted the denylist and treated an empty field as passing,
 * so it could show "all good" for a password the API rejects. One implementation
 * cannot drift from itself.
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

/** The rules a person can act on, in the order the API checks them. */
export type PasswordPolicyCheckId = 'length' | 'username' | 'email' | 'common';

export interface PasswordPolicyCheck {
  id: PasswordPolicyCheckId;
  label: string;
  met: boolean;
}

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

function emailLocalPart(email: string | null | undefined): string {
  const normalised = email?.trim().toLowerCase() ?? '';
  return normalised.includes('@') ? normalised.slice(0, normalised.indexOf('@')) : normalised;
}

/**
 * A single repeated character or a straight keyboard run is long but carries
 * almost no entropy. Folded into the denylist rule for the UI because both are
 * "too easily guessed" to a human, and the exact reason is in the message.
 */
function isPredictable(lowered: string): boolean {
  return (
    /^(.)\1+$/.test(lowered) ||
    /^(0123456789|abcdefghijklmnopqrstuvwxyz|qwertyuiop)/.test(lowered)
  );
}

function isCommonOrPredictable(lowered: string): boolean {
  return COMMON_PASSWORDS.has(lowered) || isPredictable(lowered);
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

  if (contains(lowered, email) || contains(lowered, emailLocalPart(email))) {
    return { ok: false, message: 'Password must not contain your email address.' };
  }

  if (COMMON_PASSWORDS.has(lowered)) {
    return {
      ok: false,
      message: 'That password is too common. Choose something less predictable.',
    };
  }

  if (isPredictable(lowered)) {
    return {
      ok: false,
      message: 'That password is too predictable. Choose something less obvious.',
    };
  }

  return { ok: true };
}

/**
 * The same rules, evaluated independently so a form can tick them live.
 *
 * Order mirrors `checkPasswordPolicy`. A rule that depends on the password
 * content is only "met" once something has been typed: an empty field must not
 * show green ticks, which is exactly the misleading state this replaced.
 */
export function getPasswordPolicyChecks(
  password: string,
  context: PasswordPolicyContext = {}
): PasswordPolicyCheck[] {
  const lowered = password.toLowerCase();
  const hasInput = password.length > 0;

  return [
    {
      id: 'length',
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      met: password.length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: 'username',
      label: 'Does not contain your username',
      met: hasInput && !contains(lowered, context.username),
    },
    {
      id: 'email',
      label: 'Does not contain your email address',
      met:
        hasInput &&
        !contains(lowered, context.email) &&
        !contains(lowered, emailLocalPart(context.email)),
    },
    {
      id: 'common',
      label: 'Is not a common or easily guessed password',
      met: hasInput && !isCommonOrPredictable(lowered),
    },
  ];
}
