// Custom Isracard login flow that handles OTP — the library's own login()
// short-circuits to InvalidPassword whenever Isracard's API returns anything
// other than "logged in", which now happens whenever OTP is required.
//
// Strategy: drive Puppeteer ourselves with a persistent user-data-dir so the
// "trust this device" cookie is preserved across runs. After the first
// successful login + OTP, subsequent scrapes won't see an OTP challenge.
//
// We auto-fill id/password/card6, then watch for either a login-success URL
// or the appearance of an OTP-style input. If OTP shows up, we set the shared
// scrape state to awaiting_otp, the UI submits the code, and we type it in.

import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { awaitOtp, setMessage } from './state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// One persistent profile shared across both Isracard cards (same site, same
// device-trust cookie). Stored under server/data so it survives reinstalls.
const PROFILE_DIR = path.join(__dirname, '..', 'data', '.puppeteer-isracard');
if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

const LOGIN_URL = 'https://digital.isracard.co.il/personalarea/Login/';
// Dashboard URLs Isracard redirects to after successful login. We match any
// /personalarea/ subpage that isn't the Login page itself, plus titles that
// indicate the personal area is showing.
const DASHBOARD_URL_PATTERN = /personalarea\/(?!Login)/i;
const DASHBOARD_TITLE_PATTERNS = [/אזור אישי/, /personal/i];

function showBrowser() {
  return String(process.env.SCRAPER_SHOW_BROWSER || 'false').toLowerCase() === 'true';
}

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Race a promise against a timeout. Puppeteer's element.click() doesn't honor
// an outer timeout — if the page is mid-animation/mid-navigation, the click
// can hang indefinitely. We wrap with this so the login can't get stuck.
async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function fillIfPresent(page, selectors, value) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click({ clickCount: 3 }).catch(() => {});
      await el.type(value, { delay: 30 });
      return sel;
    }
  }
  return null;
}

async function detectLoggedIn(page) {
  const url = page.url();
  // Old site personal area (pre-OTP redirect)
  if (DASHBOARD_URL_PATTERN.test(url) && !/Login/i.test(url)) return true;
  // New site — after OTP Isracard redirects here; any page that isn't a login/auth page
  if (/web\.isracard\.co\.il/i.test(url) && !/\/login|\/auth|\/identity/i.test(url)) return true;
  // Title-based fallback — Isracard's dashboard sets <title>אזור אישי | ישראכרט</title>
  // even on URLs that aren't obviously /personalarea/Main/.
  try {
    const title = await page.title();
    if (DASHBOARD_TITLE_PATTERNS.some(re => re.test(title))) {
      // Must not also be on the login page (which is also titled with "אזור אישי")
      return !/Login/i.test(url);
    }
  } catch { /* ignore */ }
  return false;
}

// Returns a browser that's already logged in to Isracard for the given card
// credentials. Caller passes the browser to the library's createScraper().
export async function loginIsracardForCard(label, credentials) {
  setMessage(`${label}: פותח דפדפן…`);
  const browser = await puppeteer.launch({
    headless: !showBrowser(),
    userDataDir: PROFILE_DIR,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let page;
  try {
    // Open a fresh blank page for the login flow rather than taking over one
    // of the session-restored tabs. The profile's cookies are shared across
    // all pages, so a new page is still authenticated if cookies are valid.
    page = await browser.newPage();

    // Cloudflare anti-bot: the page detects headless Chromium via a script
    // called `detector-dom.min.js` and a "HeadlessChrome" user-agent. The
    // library blocks the script and rewrites the UA before navigation; we
    // mirror that here so we land on the real login form, not the
    // "Attention Required!" challenge page.
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.url().includes('detector-dom.min.js')) {
        req.abort().catch(() => {});
      } else {
        req.continue().catch(() => {});
      }
    });
    const ua = await page.evaluate(() => navigator.userAgent);
    await page.setUserAgent(ua.replace('HeadlessChrome/', 'Chrome/'));

    setMessage(`${label}: טוען עמוד התחברות`);
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // First, give the persistent-profile redirect a fair chance — if we're
    // already logged in, the page will navigate away from /Login/.
    setMessage(`${label}: בודק אם כבר מחובר`);
    for (let i = 0; i < 10; i++) {
      await delay(500);
      if (await detectLoggedIn(page)) {
        setMessage(`${label}: כבר מחובר`);
        return browser;
      }
    }

    // Not logged in. Make sure we're looking at the password form, not the
    // SMS-OTP form (which is the default). The "switch to password" link is
    // <a id="flip"> and reading "או כניסה עם סיסמה קבועה".
    setMessage(`${label}: עובר לטופס סיסמה`);
    const flip = await page.$('#flip').catch(() => null);
    if (flip) {
      await withTimeout(flip.click(), 8_000, 'flip click').catch(() => {});
      // Give the form rotation animation a moment to complete.
      await delay(800);
    }

    // Wait for ANY visible login input — password form (#otpLoginId_ID) or
    // SMS-first form (#otpLobbyFormSms inputs). The older UI needed #flip to
    // switch to the password form; the newer site may show SMS form by default
    // without a flip link, so we accept either.
    try {
      await page.waitForFunction(() => {
        const pwdId = document.querySelector('#otpLoginId_ID');
        if (pwdId && pwdId.getBoundingClientRect().width > 0) return true;
        const smsInputs = document.querySelectorAll('#otpLobbyFormSms input');
        for (const el of smsInputs) {
          if (el.getBoundingClientRect().width > 0) return true;
        }
        return false;
      }, { timeout: 15_000 });
    } catch {
      const title = await page.title().catch(() => '');
      if (/cloudflare|attention required/i.test(title)) {
        throw new Error(`Isracard's site blocked us with a Cloudflare challenge ("${title}"). Try with SCRAPER_SHOW_BROWSER=true.`);
      }
      // Could be a delayed dashboard redirect — re-check.
      if (await detectLoggedIn(page)) {
        setMessage(`${label}: כבר מחובר`);
        return browser;
      }
      const url = page.url();
      throw new Error(`Login form didn't appear (url: "${url}", title: "${title}").`);
    }

    setMessage(`${label}: מזין פרטי התחברות`);
    // Try password form first; fall back to SMS form inputs.
    const idSel = await fillIfPresent(page, [
      '#otpLoginId_ID',
      'input[name="otpLoginId_ID"]',
      '#otpLobbyFormPassword input[type="tel"][maxlength="9"]',
      '#otpLobbyFormSms input[type="tel"]',
      '#otpLobbyFormSms input',
    ], credentials.id);

    if (!idSel) {
      throw new Error(`Could not find ID input on Isracard login page (url: "${page.url()}").`);
    }

    // card6 and password only exist on the password form; absent on SMS flow.
    const card6Sel = await fillIfPresent(page, [
      '#cardnum',
      'input[name="otpLoginLastDigits_ID"]',
    ], credentials.card6Digits);

    const pwdSel = await fillIfPresent(page, [
      '#otpLoginPwd',
      'input[name="otpLoginPwd"]',
      'input[type="password"]',
    ], credentials.password);

    setMessage(`${label}: שולח טופס התחברות`);
    await page.keyboard.press('Enter');

    // Race: dashboard appearance vs OTP page vs password error. We poll the
    // URL and look for OTP-style inputs. The trick is the password field
    // itself is named `otpLoginPwd` (Isracard's internal naming) — a broad
    // "contains otp" matcher would false-positive on it. So OTP must be
    // signalled by either:
    //   (a) ≥ 4 visible single-digit `<input maxlength="1">` inputs outside
    //       the SMS form (Isracard's standard 4-digit OTP grid), or
    //   (b) an `autocomplete="one-time-code"` input (the platform-standard
    //       attribute for OTP fields).
    // The previous heuristic that matched any "otp" in id/name was the cause
    // of bogus OTP prompts when password login alone was sufficient.
    setMessage(`${label}: ממתין לתשובה`);
    const raceTimeoutMs = 45_000;
    const start = Date.now();
    let otpDigitInputs = null;
    while (Date.now() - start < raceTimeoutMs) {
      if (await detectLoggedIn(page)) {
        setMessage(`${label}: התחברות הצליחה`);
        return browser;
      }
      // 4-digit OTP grid — visible inputs only. We no longer exclude
      // #otpLobbyFormSms because Isracard may render 2FA OTP inside that
      // same container on the current version of the site; visibility
      // filtering is sufficient to ignore hidden SMS-login inputs.
      const digits = await page.$$eval(
        'input[type="tel"][maxlength="1"], input[type="text"][maxlength="1"], input[type="number"][maxlength="1"]',
        els => els
          .filter(e => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map(e => e.id || e.name)
      ).catch(() => []);
      if (digits.length >= 4) { otpDigitInputs = digits.slice(0, 6); break; }
      // Platform-standard single OTP input.
      const single = await page.evaluateHandle(() => {
        const candidates = document.querySelectorAll('input[autocomplete="one-time-code"]');
        for (const el of candidates) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return el;
        }
        return null;
      });
      if (single.asElement()) { otpDigitInputs = ['__single__']; break; }
      await delay(500);
    }

    if (!otpDigitInputs) {
      throw new Error(`Isracard login didn't complete and no OTP field appeared after ${raceTimeoutMs/1000}s.`);
    }

    setMessage(`${label}: ממתין לקוד SMS`);
    const code = await awaitOtp(label);
    setMessage(`${label}: מזין קוד אימות`);

    if (otpDigitInputs.length === 1 && otpDigitInputs[0] === '__single__') {
      const inp = await page.$('input[autocomplete="one-time-code"]');
      if (!inp) throw new Error('OTP field disappeared before code arrived');
      await inp.click({ clickCount: 3 }).catch(() => {});
      await inp.type(code, { delay: 40 });
    } else {
      // Multi-input grid — Isracard auto-advances focus after each digit, so
      // focusing the first input and then typing the whole code via the page
      // keyboard is more reliable than per-input click/type (which can fight
      // with the auto-advance and end up overwriting earlier digits).
      const chars = code.replace(/\D/g, '').slice(0, otpDigitInputs.length);
      const firstHandle = await page.evaluateHandle((key) => {
        return document.getElementById(key) || document.querySelector(`input[name="${key.replace(/"/g, '\\"')}"]`);
      }, otpDigitInputs[0]);
      const firstEl = firstHandle.asElement();
      if (!firstEl) throw new Error('OTP first-digit input disappeared before code arrived');
      await firstEl.click().catch(() => {});
      await page.keyboard.type(chars, { delay: 80 });
    }

    // Try to submit; fall back to Enter on the last input.
    const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
    if (submitBtn) await withTimeout(submitBtn.click(), 5_000, 'submit click').catch(() => {});
    else await page.keyboard.press('Enter');

    setMessage(`${label}: מאמת קוד`);
    // Post-OTP, Isracard redirects through several intermediate URLs before
    // landing on web.isracard.co.il/StatusPage — give it 60s, not 30s.
    const otpWaitMs = 60_000;
    const otpStart = Date.now();
    while (Date.now() - otpStart < otpWaitMs) {
      if (await detectLoggedIn(page)) {
        setMessage(`${label}: התחברות הצליחה`);
        return browser;
      }
      await delay(500);
    }
    throw new Error('OTP submitted but dashboard never loaded — code may have been wrong or the form changed.');
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}
