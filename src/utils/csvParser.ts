import { Transaction } from '@/types/transaction';
import { categorizeMerchant } from './categories';

const HEADER_ROWS_TO_SKIP = 0; // We will scan automatically now

export function parseCSV(csvContent: string): Transaction[] {
  // Use the robust parser to get all rows respecting quoted newlines
  const rows = parseWholeCSV(csvContent);
  const transactions: Transaction[] = [];

  // Find the header row index in the PARSED rows
  const headerRowIndex = rows.findIndex(row => 
    row.some(col => col.includes('תאריך רכישה') || col.includes('שם בית עסק'))
  );

  if (headerRowIndex === -1) {
    console.warn('Header row not found, attempting to parse from first data row');
  }

  // Create a map of column name to index
  const headerRow = rows[headerRowIndex];
  const colMap = new Map<string, number>();
  headerRow.forEach((col, idx) => colMap.set(col.trim(), idx));

  // indices
  const idxDate = colMap.has('תאריך רכישה') ? colMap.get('תאריך רכישה')! : 0;
  const idxMerchant = colMap.has('שם בית עסק') ? colMap.get('שם בית עסק')! : 1;
  const idxCharge = colMap.has('סכום חיוב') ? colMap.get('סכום חיוב')! : 4;
  const idxCurrency = colMap.has('מטבע חיוב') ? colMap.get('מטבע חיוב')! : 5;
  const idxInfo = colMap.has('פירוט נוסף') ? colMap.get('פירוט נוסף')! : 8;

  const startIndex = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;

  // Per-key counter so identical (date+merchant+amount) rows get distinct, stable
  // indices — matching the scraper's indexCounter in isracard-fetch.js.
  const indexCounter = new Map<string, number>();

  for (let i = startIndex; i < rows.length; i++) {
    const columns = rows[i];
    // Relaxed length check, we just need enough valid columns
    if (columns.length < 2) continue;

    const dateStr = columns[idxDate];
    const merchantName = columns[idxMerchant];
    const chargeAmountStr = columns[idxCharge];
    const currency = columns[idxCurrency];
    const additionalInfo = columns[idxInfo];

    // Check for "Standing Order" (הוראת קבע) in ANY column to be safe
    // We explicitly convert to string and use includes to catch cases like "אתר חו"ל הוראת קבע"
    const isStandingOrder = columns.some(col => 
      col && String(col).includes('הוראת קבע')
    );

    // Skip if no valid date
    if (!dateStr || !dateStr.match(/\d{2}\.\d{2}\.\d{2}/)) continue;

    const origPurchaseDate = parseHebrewDate(dateStr);
    let purchaseDate = origPurchaseDate;
    const chargeAmount = parseNumber(chargeAmountStr);

    if (isNaN(purchaseDate.getTime()) || isNaN(chargeAmount)) continue;

    const installments = parseInstallments(columns);

    // Shift installment transactions to their actual billing month, matching
    // postProcessTransaction in server/scrapers/postProcess.js. Never override
    // with the CSV header's billing month — the purchase date + (N-1) months
    // gives the same billing month and keeps purchaseDate accurate.
    if (installments) {
      const d = new Date(purchaseDate);
      d.setMonth(d.getMonth() + installments.current - 1);
      purchaseDate = d;
    }

    // Clean up "Standing Order" text from additional info to avoid duplication
    let cleanedInfo = additionalInfo?.trim() || '';
    if (isStandingOrder) {
      cleanedInfo = cleanedInfo.replace(/הוראת קבע/g, '').trim();
    }

    const category = categorizeMerchant(merchantName, cleanedInfo);

    // Group by purchase month (matching scraper behaviour). Do NOT use the
    // CSV header's billing month — that would put May purchases into June.
    const rowStatementDate = new Date(purchaseDate.getFullYear(), purchaseDate.getMonth(), 1);

    // ID uses the ORIGINAL purchase date (before installment shift) + per-key
    // counter, matching normalizeIsracardRow in server/scrapers/isracard-fetch.js
    // so that the same transaction doesn't appear twice when both scraping and
    // CSV upload are active.
    const idIso = origPurchaseDate.toISOString();
    const idKey = `${idIso}|${merchantName}|${chargeAmount}`;
    const idx = indexCounter.get(idKey) ?? 0;
    indexCounter.set(idKey, idx + 1);

    const transaction: Transaction = {
      id: `${idIso}-${merchantName}-${chargeAmount}-${idx}`,
      purchaseDate,
      statementDate: rowStatementDate,
      merchantName: merchantName?.trim() || 'לא ידוע',
      chargeAmount,
      currency: currency?.trim() || '₪',
      additionalInfo: cleanedInfo,
      isStandingOrder: isStandingOrder,
      installments,
      category,
    };

    transactions.push(transaction);
  }

  return transactions;
}

// Robust State-Machine CSV Parser
function parseWholeCSV(content: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  
  // Normalize CRLF to LF to simplify logic
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote ("") -> add a single quote and skip next
        currentCell += '"';
        i++; 
      } else {
        // Toggle state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of cell
      currentRow.push(currentCell.trim()); // Trim whitespace around cell values? Usually safe.
      currentCell = '';
    } else if (char === '\n' && !inQuotes) {
      // End of row
      currentRow.push(currentCell.trim());
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else {
      // Regular character
      currentCell += char;
    }
  }

  // Push last cell/row if exists
  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  return rows;
}

function parseHebrewDate(dateStr: string): Date {
  // Format: DD.MM.YY
  const parts = dateStr.split('.');
  if (parts.length !== 3) return new Date(NaN);

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // 0-indexed
  let year = parseInt(parts[2], 10);

  // Handle 2-digit year
  if (year < 100) {
    year += year > 50 ? 1900 : 2000;
  }

  // Use noon to avoid UTC date-shift: midnight local time (e.g. UTC+3) converts
  // to the previous day in ISO strings, making IDs differ from the scraper
  // which also uses local noon via parseHebDate.
  return new Date(year, month, day, 12, 0, 0);
}

function parseNumber(str: string): number {
  if (!str) return 0;
  // Remove commas and any non-numeric characters except minus and decimal
  const cleaned = str.replace(/[^\d.-]/g, '');
  return parseFloat(cleaned) || 0;
}

function parseInstallments(columns: string[]): { current: number; total: number } | undefined {
  // Regex patterns to match:
  // "תשלום 4 מתוך 12"
  // "4 מתוך 12"
  // "תשלום 4/12"
  const patterns = [
    /תשלום\s+(\d+)\s+מתוך\s+(\d+)/,
    /(\d+)\s+מתוך\s+(\d+)/,
    /תשלום\s+(\d+)\/(\d+)/
  ];

  for (const col of columns) {
    if (!col) continue;
    for (const pattern of patterns) {
      const match = col.match(pattern);
      if (match) {
        const current = parseInt(match[1], 10);
        const total = parseInt(match[2], 10);
        if (!isNaN(current) && !isNaN(total) && total > 0) {
          return { current, total };
        }
      }
    }
  }
  return undefined;
}

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
];

function extractStatementDate(lines: string[]): Date | null {
  // Look in the first 10 lines for patterns like "פברואר 2026"
  const linesToSearch = lines.slice(0, 10);
  
  for (const line of linesToSearch) {
    for (let i = 0; i < HEBREW_MONTHS.length; i++) {
        const monthName = HEBREW_MONTHS[i];
        // Match "Month ... YYYY" allowing for CSV characters (quotes, commas, spaces) in between
        // e.g. "פברואר",,"2026"
        const regex = new RegExp(`${monthName}.{0,30}(\\d{4})`);
        const match = line.match(regex);
        
        if (match) {
            const year = parseInt(match[1], 10);
            // Return the 1st of that month to ensure it falls correctly in the period
            return new Date(year, i, 1);
        }
    }
  }
  return null;
}

export function parseMultipleCSVs(files: File[]): Promise<Transaction[]> {
  return Promise.all(
    files.map(file => 
      new Promise<Transaction[]>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          resolve(parseCSV(content));
        };
        reader.onerror = () => resolve([]);
        reader.readAsText(file, 'UTF-8');
      })
    )
  ).then(results => {
    // Flatten and deduplicate by id
    const allTransactions = results.flat();
    const seen = new Set<string>();
    return allTransactions.filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  });
}
