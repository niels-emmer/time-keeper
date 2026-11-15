/**
 * Screenshot capture for `docs/screenshots/` — 390×844 @2x, dark theme.
 *
 * Covers the four tabs plus the auth surfaces (login, account, admin users,
 * reset, register). Demo data is seeded through the API first: an empty app
 * makes a poor screenshot and hides layout problems.
 *
 * Playwright is intentionally *not* a project dependency (it downloads browser
 * binaries and would need a SECURITY.md dependency review for a dev-only tool).
 * Install it outside the repo and point the script at it:
 *
 *   mkdir -p /tmp/pw && cd /tmp/pw && npm init -y && npm i playwright
 *   npx playwright install chromium
 *
 *   PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.mjs \
 *   PLAYWRIGHT_CHROMIUM="$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-mac-arm64/chrome-headless-shell" \
 *   SCREENSHOT_BASE=http://localhost:5173 \
 *   SCREENSHOT_PASSWORD='the dev admin password' \
 *   node scripts/take-screenshots.mjs
 *
 * The dev admin must be an account without MFA enrolled on the first run; the
 * script enrols TOTP itself and prints the secret so a second run can reuse it
 * via SCREENSHOT_TOTP_SECRET.
 */

import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../docs/screenshots');

const BASE = process.env.SCREENSHOT_BASE ?? 'http://localhost:5173';
const USERNAME = process.env.SCREENSHOT_USER ?? 'devadmin';
const PASSWORD = process.env.SCREENSHOT_PASSWORD;
const TOTP_SECRET = process.env.SCREENSHOT_TOTP_SECRET;
const VIEWPORT = { width: 390, height: 844 };

if (!PASSWORD) {
  console.error('SCREENSHOT_PASSWORD is required (the dev admin password).');
  process.exit(1);
}

const playwright = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const launchOptions = { headless: true };
if (process.env.PLAYWRIGHT_CHROMIUM) {
  launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM;
}
const browser = await playwright.chromium.launch(launchOptions);

// ── TOTP (RFC 6238), so the script can complete its own second factor ────────
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalised = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of normalised) {
    value = ((value << 5) | alphabet.indexOf(character)) & ((1 << (bits + 5)) - 1);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totp(secret, timeMs = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30000)));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(truncated % 1_000_000).padStart(6, '0');
}

// ── API helpers executed inside the page (session cookie + CSRF header) ──────
async function api(page, method, apiPath, body, attempt = 0) {
  const result = await page.evaluate(
    async ({ method, apiPath, body }) => {
      const csrf = document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('tk_csrf='))
        ?.slice('tk_csrf='.length);
      const response = await fetch(`/api${apiPath}`, {
        method,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { status: response.status, body: parsed, retryAfter: response.headers.get('retry-after') };
    },
    { method, apiPath, body }
  );

  // The API allows 120 requests/minute per IP. Seeding plus a couple of page
  // loads fits, but back-to-back runs do not; honour Retry-After instead of
  // baking a half-loaded screen into a screenshot.
  if (result.status === 429 && attempt < 3) {
    const waitMs = Math.min(65_000, (Number(result.retryAfter ?? 10) + 2) * 1000);
    console.log(`  rate limited; waiting ${Math.round(waitMs / 1000)}s`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return api(page, method, apiPath, body, attempt + 1);
  }

  return result;
}

function isoDay(offsetDays, hour, minute = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

/** Monday of the current ISO week, as a day offset from today (UTC). */
function mondayOffset() {
  const day = new Date().getUTCDay(); // 0 = Sunday
  return day === 0 ? -6 : 1 - day;
}

/**
 * The API allows 120 requests/minute per IP, and one capture run needs most of
 * a minute's budget. Wait for headroom instead of photographing a half-loaded
 * page after a 429.
 */
async function waitForBudget(minRemaining = 80) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch(`${BASE}/api/health`);
    const remaining = response.headers.get('ratelimit-remaining');
    if (response.status !== 429 && (remaining === null || Number(remaining) >= minRemaining)) {
      return;
    }
    console.log(`  API budget low (${remaining ?? 'unknown'} left); waiting 30s`);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}

await waitForBudget();

const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await page.addInitScript(() => localStorage.setItem('time-keeper-theme', 'dark'));

/**
 * Navigate, and wait out the per-IP rate limit if a page's queries hit it.
 * A half-loaded card is worse than a slow capture, and the 120/min budget is
 * shared with the seeding calls.
 */
async function gotoReady(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(url, { waitUntil: 'networkidle' });
    const limited = await page.getByText(/Too many requests/i).count();
    if (limited === 0) return;
    console.log('  page hit the rate limit; waiting 62s, then reloading');
    await new Promise((resolve) => setTimeout(resolve, 62_000));
  }
}

async function shoot(name, { scrollTo } = {}) {
  if (scrollTo) {
    // Put the target near the top of the content area, below the sticky header,
    // without dragging in the tail of whatever card precedes it.
    const box = await page.locator(scrollTo).first().boundingBox();
    if (box) {
      await page.evaluate(
        (delta) => window.scrollBy(0, delta),
        box.y - 96
      );
    }
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`✓ ${name}.png`);
}

// ── login.png (signed out) ───────────────────────────────────────────────────
await gotoReady(`${BASE}/login`);
await shoot('login');

// ── Sign in ──────────────────────────────────────────────────────────────────
await page.getByLabel('Username or email').fill(USERNAME);
await page.getByLabel('Password').fill(PASSWORD);
await page.getByRole('button', { name: 'Sign in' }).click();

let secret = TOTP_SECRET;
const mfaPrompt = page.getByLabel('Authentication code');
const mfaRequired = await mfaPrompt
  .waitFor({ timeout: 4000 })
  .then(() => true)
  .catch(() => false);
if (mfaRequired) {
  if (!secret) {
    throw new Error(
      'This account already has MFA enrolled. Re-run with SCREENSHOT_TOTP_SECRET=<its secret>.'
    );
  }
  // The server rejects a code whose 30-second step was already consumed, so a
  // second run inside the same step is a replay. Wait for the next code rather
  // than reporting a failure that is not one.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await mfaPrompt.fill(totp(secret));
    await page.getByRole('button', { name: /Verify and sign in/i }).click();
    await page.waitForTimeout(1500);
    if (await page.locator('nav').count()) break;
    const said = (await page.locator('[role="alert"]').allInnerTexts()).join(' ');
    if (!/already been used/i.test(said)) {
      throw new Error(`Sign-in failed: ${said || '(no message)'}`);
    }
    console.log('  that code was used in its 30s step; waiting for the next one');
    await page.waitForTimeout(31_000);
  }
}
// Wait for the app shell, not for a string that the sign-in card also shows —
// navigating away mid-verification would abort the MFA request.
try {
  await page.locator('nav').first().waitFor({ timeout: 15000 });
} catch {
  const alerts = await page.locator('[role="alert"]').allInnerTexts();
  throw new Error(`Sign-in did not complete. Page said: ${alerts.join(' | ') || '(nothing)'}`);
}
await page.waitForTimeout(800);

// ── Enrol MFA if the account has none (admin screens need it) ────────────────
// Done through the API rather than by scraping the QR panel: the secret is the
// one thing that must not be mis-read, and a wrong value here makes every later
// run unable to sign in.
await gotoReady(`${BASE}/account`);
if (!secret) {
  const enrolment = await api(page, 'POST', '/auth/mfa/enrol');
  if (enrolment.status === 200) {
    secret = enrolment.body.secret;
    const confirmed = await api(page, 'POST', '/auth/mfa/confirm', { code: totp(secret) });
    if (confirmed.status !== 200) {
      throw new Error(`MFA confirm failed: ${JSON.stringify(confirmed.body)}`);
    }
    console.log(`MFA enrolled. Reuse with SCREENSHOT_TOTP_SECRET=${secret}`);
  } else if (enrolment.body?.code === 'mfa_already_enabled') {
    throw new Error(
      'This account already has MFA enrolled. Re-run with SCREENSHOT_TOTP_SECRET=<its secret>.'
    );
  }
}

// ── Seed demo data ───────────────────────────────────────────────────────────
const existing = await api(page, 'GET', '/categories');
const have = new Set((existing.body ?? []).map((category) => category.name));

const categorySpecs = [
  { name: 'Deep Work', color: '#207D9B', workdayCode: 'DW', billable: true, targetCadence: 'weekly', targetMinutes: 1200 },
  { name: 'Meetings', color: '#7C5CD6', workdayCode: 'MTG', billable: false, targetCadence: 'monthly', targetMinutes: 3600 },
  { name: 'Admin', color: '#5A6B7B', workdayCode: 'ADM', billable: false },
  { name: 'Support', color: '#D9822B', workdayCode: 'SUP', billable: true },
  { name: 'Learning', color: '#2F855A', workdayCode: 'LRN', billable: false, targetCadence: 'monthly', targetMinutes: 900 },
];

const categories = {};
for (const spec of categorySpecs) {
  if (have.has(spec.name)) {
    const found = (existing.body ?? []).find((category) => category.name === spec.name);
    categories[spec.name] = found.id;
    continue;
  }
  const created = await api(page, 'POST', '/categories', spec);
  if (created.status >= 300) {
    throw new Error(`Could not create category ${spec.name}: ${JSON.stringify(created.body)}`);
  }
  categories[spec.name] = created.body.id;
}

// Only seed entries when the account has none, so a re-run does not pile up.
const thisWeek = await api(page, 'GET', `/entries?week=${isoWeekString(0)}`);
const lastWeek = await api(page, 'GET', `/entries?week=${isoWeekString(-1)}`);
if ((thisWeek.body?.length ?? 0) === 0 && (lastWeek.body?.length ?? 0) === 0) {
  const monday = mondayOffset();
  const plan = [
    { day: 0, blocks: [['Deep Work', 9, 0, 11, 30], ['Meetings', 11, 30, 12, 15], ['Admin', 13, 0, 14, 0]] },
    { day: 1, blocks: [['Deep Work', 9, 0, 12, 0], ['Support', 13, 30, 15, 0], ['Admin', 15, 0, 15, 45]] },
    { day: 2, blocks: [['Meetings', 9, 30, 10, 30], ['Deep Work', 10, 30, 12, 30], ['Learning', 14, 0, 15, 0]] },
    { day: 3, blocks: [['Deep Work', 9, 0, 11, 0], ['Support', 11, 0, 12, 0], ['Admin', 13, 0, 13, 45], ['Deep Work', 14, 0, 16, 0]] },
    { day: 4, blocks: [['Meetings', 10, 0, 11, 0], ['Deep Work', 11, 0, 13, 0], ['Learning', 15, 0, 16, 30]] },
  ];

  for (const weekOffset of [0, -7]) {
    for (const dayPlan of plan) {
      const offset = monday + weekOffset + dayPlan.day;
      for (const [name, sh, sm, eh, em] of dayPlan.blocks) {
        // Never seed into the future: the API rejects it, and a future block
        // would be a nonsense screenshot.
        if (new Date(isoDay(offset, sh, sm)) > new Date()) continue;
        const created = await api(page, 'POST', '/entries', {
          categoryId: categories[name],
          startTime: isoDay(offset, sh, sm),
          endTime: isoDay(offset, eh, em),
        });
        if (created.status >= 300) {
          throw new Error(`Could not create entry: ${JSON.stringify(created.body)}`);
        }
      }
    }
  }
  console.log('Seeded demo categories and time entries.');
} else {
  console.log('Demo entries already present; not seeding again.');
}

// ── Tabs ────────────────────────────────────────────────────────────────────
for (const tab of [
  { name: 'track', url: '/' },
  { name: 'weekly', url: '/weekly' },
  { name: 'monthly', url: '/monthly' },
  { name: 'settings', url: '/settings' },
]) {
  await gotoReady(`${BASE}${tab.url}`);
  await shoot(tab.name);
}

// ── account.png ─────────────────────────────────────────────────────────────
await gotoReady(`${BASE}/account`);
await page.waitForSelector('text=Two-factor authentication');
await shoot('account');

// ── admin users (needs a second account, one disabled) ───────────────────────
let accounts = (await api(page, 'GET', '/admin/users')).body?.users ?? [];
let jordan = accounts.find((account) => account.username === 'jordan');

if (!jordan) {
  const created = await api(page, 'POST', '/admin/users', {
    email: 'jordan@example.com',
    username: 'jordan',
    role: 'user',
  });
  if (created.status >= 300) {
    throw new Error(`Could not create the demo account: ${JSON.stringify(created.body)}`);
  }
  jordan = { ...created.body.user, disabled: false };
}

// One disabled row makes the status control meaningful in the screenshot.
await api(page, 'PATCH', `/admin/users/${jordan.id}`, { disabled: true });

await gotoReady(`${BASE}/settings`);
await shoot('admin-users', { scrollTo: 'h3:has-text("Users")' });

// ── reset.png (signed out, valid unused code) ────────────────────────────────
// Always a freshly issued code: a code is single-use and this keeps the run
// repeatable. Re-enable the account first so the link belongs to a usable one.
await api(page, 'PATCH', `/admin/users/${jordan.id}`, { disabled: false });
const issued = await api(page, 'POST', `/admin/users/${jordan.id}/reset`);
const resetCode = issued.body?.resetCode ?? null;
if (!resetCode) {
  console.warn(`Could not issue a reset code (HTTP ${issued.status}):`, issued.body);
}

if (resetCode) {
  const anon = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await anon.addInitScript(() => localStorage.setItem('time-keeper-theme', 'dark'));
  await anon.goto(`${BASE}/reset?code=${encodeURIComponent(resetCode)}`, { waitUntil: 'networkidle' });
  await anon.waitForTimeout(700);
  await anon.screenshot({ path: path.join(OUT, 'reset.png') });
  console.log('✓ reset.png');
  await anon.close();
} else {
  console.warn('No reset code available; skipped reset.png');
}

// ── register.png (signed out, fresh unused invite) ──────────────────────────
// The invite token is the only credential the page needs; minting a fresh one
// keeps the run repeatable, and nothing is submitted so it is not consumed.
const invite = await api(page, 'POST', '/admin/invites', { role: 'user' });
const inviteToken = invite.body?.token ?? null;
if (inviteToken) {
  const anon = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await anon.addInitScript(() => localStorage.setItem('time-keeper-theme', 'dark'));
  await anon.goto(`${BASE}/register?token=${encodeURIComponent(inviteToken)}`, {
    waitUntil: 'networkidle',
  });
  await anon.waitForTimeout(700);
  await anon.screenshot({ path: path.join(OUT, 'register.png') });
  console.log('✓ register.png');
  await anon.close();
} else {
  console.warn(`Could not mint an invite (HTTP ${invite.status}); skipped register.png`);
}

await browser.close();
console.log('Done.');

/** ISO-8601 week string for the week containing today plus `weekOffset` weeks. */
function isoWeekString(weekOffset = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + weekOffset * 7);
  // ISO week: Thursday determines the year.
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7; // Monday = 0
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
