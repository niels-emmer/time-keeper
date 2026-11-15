/**
 * Password policy (Q22) — re-exported from `@time-keeper/shared`.
 *
 * The implementation moved into the shared package so the API and the invite
 * form's live checklist run the exact same rules. This module stays as the
 * backend's import surface, so every existing caller keeps working unchanged.
 */
export {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  checkPasswordPolicy,
  getPasswordPolicyChecks,
  type PasswordPolicyContext,
  type PasswordPolicyResult,
  type PasswordPolicyCheck,
  type PasswordPolicyCheckId,
} from '@time-keeper/shared';
