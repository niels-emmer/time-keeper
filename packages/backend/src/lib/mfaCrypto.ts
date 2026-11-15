import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { resolveMfaEncryptionKey } from './config.js';

/**
 * Encryption for TOTP secrets at rest (D3 / Q-D3).
 *
 * AES-256-GCM with a fresh 96-bit IV per record and the authentication tag kept
 * alongside the ciphertext. GCM is chosen because it authenticates: a modified
 * ciphertext or tag fails to decrypt rather than yielding a wrong secret that
 * would silently lock a user out of their own account.
 *
 * Stored format, self-describing so the key or algorithm can be rotated later:
 *
 *   v1:<iv-base64url>:<tag-base64url>:<ciphertext-base64url>
 *
 * The key is `MFA_ENCRYPTION_KEY` (32 bytes, base64 or hex). Nothing in this
 * module logs, and no caller may log the plaintext secret or the `otpauth://`
 * URI built from it.
 */

export const MFA_CIPHERTEXT_PREFIX = 'v1';
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for
const TAG_BYTES = 16;

export function encryptSecret(plaintext: string): string {
  const key = resolveMfaEncryptionKey();
  // A unique IV per record is what keeps GCM safe: reusing one with the same key
  // destroys confidentiality and authenticity at the same time.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    MFA_CIPHERTEXT_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/**
 * Decrypt a stored secret, or return `null`.
 *
 * Every failure mode — wrong key, wrong IV/tag length, truncated value, or a
 * tag that does not authenticate — is the same `null`. Callers treat it as "no
 * usable secret", never as a 500, so a corrupted row cannot be distinguished
 * from an unenrolled account by the response.
 */
export function decryptSecret(payload: string): string | null {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== MFA_CIPHERTEXT_PREFIX) {
    return null;
  }

  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
    return null;
  }

  try {
    const key = resolveMfaEncryptionKey();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    return null;
  }
}
