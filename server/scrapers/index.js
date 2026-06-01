// Local-only credential-based scraper for Isracard cards and Otsar HaHayal bank.
// Wraps `israeli-bank-scrapers` and normalizes its output into the same
// `Transaction` shape that `src/utils/csvParser.ts` produces, so the rest of
// the app can treat scraped rows identically to CSV-uploaded rows.
//
// Credentials come from environment variables (see .env.example). Output is
// persisted as JSON under server/data/scraped/ so the client can read it
// without re-running the scraper on every page load.

import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginIsracardForCard } from './isracard-otp.js';
import { fetchCardList, fetchCardHistory, normalizeIsracardRow, warmUpTransactionsPage } from './isracard-fetch.js';
import { postProcessTransaction } from './postProcess.js';
import { setRunning, setDone, setFailed, reset, isBusy } from './state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scrapedDir = path.join(__dirname, '..', 'data', 'scraped');
if (!fs.existsSync(scrapedDir)) fs.mkdirSync(scrapedDir, { recursive: true });

function lookbackDays() {
  return Number(process.env.SCRAPER_LOOKBACK_DAYS || 90);
}

function startDate() {
  const d = new Date();
  d.setDate(d.getDate() - lookbackDays());
  return d;
}

function showBrowser() {
  return String(process.env.SCRAPER_SHOW_BROWSER || 'false').toLowerCase() === 'true';
}

// Match csvParser.ts:90 id composition: `${ISO date}-${merchant}-${amount}-${idx}`.
// `idx` disambiguates same-day same-merchant same-amount rows. We keep a
// running counter per bucket across providers so two cards with identical
// charges don't both claim idx 0.
function mintId(purchaseDate, merchantName, chargeAmount, indexCounter) {
  const key = `${purchaseDate.toISOString()}|${merchantName}|${chargeAmount}`;
  const idx = indexCounter.get(key) ?? 0;
  indexCounter.set(key, idx + 1);
  return `${purchaseDate.toISOString()}-${merchantName}-${chargeAmount}-${idx}`;
}

// Library returns `chargedAmount` negative for debits. The app treats positive
// `chargeAmount` as spend, so we flip the sign.
function normalizeTxn(txn, indexCounter) {
  const purchaseDate = new Date(txn.date);
  const merchantName = String(txn.description || '').trim();
  const chargeAmount = -Number(txn.chargedAmount ?? 0);
  const description = `${txn.description || ''} ${txn.memo || ''}`;
  const isStandingOrder = description.includes('הוראת קבע');

  return {
    id: mintId(purchaseDate, merchantName, chargeAmount, indexCounter),
    purchaseDate: purchaseDate.toISOString(),
    statementDate: (txn.processedDate ? new Date(txn.processedDate) : purchaseDate).toISOString(),
    merchantName,
    chargeAmount,
    currency: txn.originalCurrency || 'ILS',
    additionalInfo: txn.memo || '',
    isStandingOrder,
    installments: txn.installments
      ? { current: txn.installments.number, total: txn.installments.total }
      : undefined,
  };
}

async function runScraper(companyId, credentials, label, onProgress) {
  const verbose = String(process.env.SCRAPER_VERBOSE || 'false').toLowerCase() === 'true';
  const scraper = createScraper({
    companyId,
    startDate: startDate(),
    combineInstallments: false,
    showBrowser: showBrowser(),
    verbose,
  });
  if (typeof onProgress === 'function') {
    scraper.onProgress((companyType, payload) => {
      onProgress(label, payload?.type || 'UNKNOWN');
    });
  }
  const result = await scraper.scrape(credentials);
  if (!result.success) {
    const msg = result.errorMessage || result.errorType || 'unknown error';
    throw new Error(`${label} failed: ${msg}`);
  }
  return result.accounts || [];
}

function persist(filename, transactions) {
  const file = path.join(scrapedDir, filename);
  fs.writeFileSync(file, JSON.stringify({
    scrapedAt: new Date().toISOString(),
    transactions,
  }, null, 2));
}

// Scrape all active Isracard cards on the user's account with a single login.
// Isracard's GetCardList returns every card on the login (so the user's two
// cards both come from one auth flow), and we fetch transactions per card by
// walking billing months backwards via the new web.isracard.co.il API. The
// library's own fetch is broken because it targets the retired
// digital.isracard.co.il/services endpoints.
async function scrapeIsracardAll(indexCounter) {
  // Either credential set is fine — they share the same login on a real
  // account; just use whichever is filled in.
  const id = process.env.ISRACARD_CARD1_ID || process.env.ISRACARD_CARD2_ID;
  const password = process.env.ISRACARD_CARD1_PASSWORD || process.env.ISRACARD_CARD2_PASSWORD;
  // card6Digits is only used by our OTP-aware login form filler — pick either.
  const card6Digits = process.env.ISRACARD_CARD1_CARD6 || process.env.ISRACARD_CARD2_CARD6;
  if (!id || !password || !card6Digits) return [];

  // Optional opt-in filter: if the user listed card6 values in .env, only
  // scrape cards whose last-4 matches one of them. Otherwise scrape every
  // active card on the account.
  const allowedCard6 = [
    process.env.ISRACARD_CARD1_CARD6,
    process.env.ISRACARD_CARD2_CARD6,
  ].filter(Boolean);
  const allowedLast4 = new Set(allowedCard6.map(s => s.slice(-4)));

  setRunning('isracard');
  const browser = await loginIsracardForCard('isracard', { id, password, card6Digits });
  try {
    const pages = await browser.pages();
    const page = pages.find(p => /isracard/i.test(p.url())) || pages[0];

    await warmUpTransactionsPage(page);

    const allCards = await fetchCardList(page);
    const activeCards = allCards.filter(c => String(c.cardStatus) === '0' && c.isActive);
    // If user specified card6 values, filter to those; otherwise take all active.
    const cardsToScrape = allowedLast4.size > 0
      ? activeCards.filter(c => allowedLast4.has(c.cardSuffix))
      : activeCards;

    if (cardsToScrape.length === 0) {
      throw new Error(`No matching active cards. Available: ${activeCards.map(c => c.cardSuffix).join(', ')}; allowed: ${[...allowedLast4].join(', ')}`);
    }

    const maxMonths = Math.min(
      120,
      Math.max(1, Math.ceil(Number(process.env.SCRAPER_LOOKBACK_DAYS || 90) / 30))
    );

    const providers = [];
    for (const card of cardsToScrape) {
      const label = `isracard-${card.cardSuffix}`;
      setRunning(label);
      const { all: rawRows, errors } = await fetchCardHistory(page, card, { maxMonths, label: card.cardSuffix });
      const txns = rawRows
        .map(r => normalizeIsracardRow(r.raw, r.source, indexCounter))
        .filter(Boolean);
      persist(`${label}.json`, txns);
      providers.push({ provider: label, count: txns.length, monthErrors: errors });
    }
    return providers;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function scrapeOtsar(indexCounter, onProgress) {
  const username = process.env.OTSAR_USERNAME;
  const password = process.env.OTSAR_PASSWORD;
  if (!username || !password) return null;

  setRunning('otsarHahayal');
  const accounts = await runScraper(CompanyTypes.otsarHahayal, { username, password }, 'otsarHahayal', onProgress);
  const txns = accounts.flatMap(a => (a.txns || []).map(t => normalizeTxn(t, indexCounter)));
  persist('otsarHahayal.json', txns);
  return { provider: 'otsarHahayal', count: txns.length };
}

export async function scrapeAll({ onProgress } = {}) {
  if (isBusy()) {
    throw new Error('Scrape already in progress');
  }
  reset();

  const indexCounter = new Map();
  const providers = [];
  const errors = [];

  const tasks = [
    // Single Isracard task — one login covers every card on the account.
    async () => {
      const results = await scrapeIsracardAll(indexCounter);
      return results;
    },
    () => scrapeOtsar(indexCounter, onProgress),
  ];

  // Run sequentially: Puppeteer is heavy and running multiple browsers in
  // parallel on a laptop tends to time out one of them.
  for (const task of tasks) {
    try {
      const out = await task();
      if (!out) continue;
      if (Array.isArray(out)) providers.push(...out);
      else providers.push(out);
    } catch (e) {
      errors.push({ message: e.message });
    }
  }

  const result = {
    providers,
    errors,
    totalTransactions: providers.reduce((s, p) => s + (p.count || 0), 0),
  };
  if (errors.length > 0 && providers.length === 0) {
    setFailed(errors.map(e => e.message).join(' · '));
  } else {
    setDone(result);
  }
  return result;
}

// Merchant names that represent money movements, not actual spending. The
// canonical example is "העברה מהחשבון" — the bank-side lump-sum charge for
// a credit-card statement; the per-merchant Isracard rows already cover the
// underlying spending, so this aggregate would double-count.
const IGNORED_MERCHANT_NAMES = new Set([
  'ישראכרט בע"מ',
]);

function shouldIgnoreScrapedTxn(t) {
  const name = (t?.merchantName || '').trim();
  return IGNORED_MERCHANT_NAMES.has(name);
}

export function readAllScraped() {
  if (!fs.existsSync(scrapedDir)) return [];
  const out = [];
  for (const file of fs.readdirSync(scrapedDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(scrapedDir, file), 'utf-8'));
      if (!Array.isArray(parsed.transactions)) continue;
      for (const t of parsed.transactions) {
        if (shouldIgnoreScrapedTxn(t)) continue;
        out.push(postProcessTransaction(t));
      }
    } catch (e) {
      console.warn(`Failed to read scraped file ${file}:`, e.message);
    }
  }
  return out;
}

export function readScrapedMeta() {
  if (!fs.existsSync(scrapedDir)) return [];
  return fs.readdirSync(scrapedDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(scrapedDir, f), 'utf-8'));
        return {
          provider: f.replace(/\.json$/, ''),
          scrapedAt: parsed.scrapedAt,
          count: Array.isArray(parsed.transactions) ? parsed.transactions.length : 0,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
