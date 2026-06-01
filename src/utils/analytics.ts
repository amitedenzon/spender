import { Transaction, WeeklyData, DailyData, MerchantData, RecurrentPayment, PaymentChange } from '@/types/transaction';

// Income (salary, refunds, credits) lands as a negative chargeAmount — the
// bank-account scraper flips the sign on credits and CSV statements only
// contain positive charges. All spending aggregates filter via this helper
// so income doesn't subtract from totals or pollute category breakdowns.
function expensesOnly(transactions: Transaction[]): Transaction[] {
  return transactions.filter(t => t.chargeAmount > 0);
}

export function calculateTotalSpending(transactions: Transaction[]): number {
  return expensesOnly(transactions)
    .filter(t => t.category !== 'השקעות')
    .reduce((sum, t) => sum + t.chargeAmount, 0);
}

// Sum of all credits in the period (returned as a positive number).
export function calculateIncomeTotal(transactions: Transaction[]): number {
  let sum = 0;
  for (const t of transactions) {
    if (t.chargeAmount < 0) sum += -t.chargeAmount;
  }
  return sum;
}

export function countIncomeTransactions(transactions: Transaction[]): number {
  return transactions.filter(t => t.chargeAmount < 0).length;
}

export function calculateDailyAverage(transactions: Transaction[], daysInPeriod: number): number {
  const total = calculateTotalSpending(transactions);
  return daysInPeriod > 0 ? total / daysInPeriod : 0;
}

export function calculateInvestmentTotal(transactions: Transaction[]): number {
  return expensesOnly(transactions)
    .filter(t => t.category === 'השקעות')
    .reduce((sum, t) => sum + t.chargeAmount, 0);
}

export function calculateStandingOrdersTotal(
  transactions: Transaction[],
  recurringMerchants: Set<string> = new Set()
): number {
  return expensesOnly(transactions)
    .filter(t => t.isStandingOrder || recurringMerchants.has(t.merchantName))
    .reduce((sum, t) => sum + t.chargeAmount, 0);
}

// Returns the set of merchant names considered "regular" spending: bank-flagged
// standing orders, plus merchants auto-detected as recurring by findRecurrentPayments.
export function getRecurringMerchantNames(allTransactions: Transaction[]): Set<string> {
  const set = new Set<string>();
  for (const t of expensesOnly(allTransactions)) {
    if (t.isStandingOrder) set.add(t.merchantName);
  }
  for (const r of findRecurrentPayments(allTransactions)) {
    set.add(r.merchantName);
  }
  return set;
}

export function findPaymentChanges(
  allTransactions: Transaction[],
  selectedMonth: number,
  selectedYear: number,
  lookbackMonths: number = 3
): PaymentChange[] {
  const byMerchant = new Map<string, Map<string, number>>();
  for (const t of expensesOnly(allTransactions)) {
    const key = `${t.statementDate.getFullYear()}-${t.statementDate.getMonth()}`;
    if (!byMerchant.has(t.merchantName)) byMerchant.set(t.merchantName, new Map());
    const m = byMerchant.get(t.merchantName)!;
    m.set(key, (m.get(key) || 0) + t.chargeAmount);
  }

  const currentKey = `${selectedYear}-${selectedMonth}`;
  const baselineKeys: string[] = [];
  for (let i = 1; i <= lookbackMonths; i++) {
    const d = new Date(selectedYear, selectedMonth - i, 1);
    baselineKeys.push(`${d.getFullYear()}-${d.getMonth()}`);
  }

  const out: PaymentChange[] = [];
  byMerchant.forEach((months, merchantName) => {
    const current = months.get(currentKey);
    if (current == null) return;

    const baselineValues: number[] = [];
    for (const k of baselineKeys) {
      const v = months.get(k);
      if (v != null) baselineValues.push(v);
    }
    if (baselineValues.length === 0) return;

    const baseline = baselineValues.reduce((a, b) => a + b, 0) / baselineValues.length;
    const delta = current - baseline;

    if (Math.abs(delta) < 10) return;
    if (baseline > 0 && Math.abs(delta) / baseline < 0.1) return;

    out.push({
      merchantName,
      currentAmount: current,
      baselineAmount: baseline,
      delta,
      baselineMonthCount: baselineValues.length,
    });
  });

  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function getTopMerchant(transactions: Transaction[]): MerchantData | null {
  const merchantMap = new Map<string, MerchantData>();

  expensesOnly(transactions).forEach(t => {
    const existing = merchantMap.get(t.merchantName) || { name: t.merchantName, total: 0, count: 0 };
    existing.total += t.chargeAmount;
    existing.count += 1;
    merchantMap.set(t.merchantName, existing);
  });

  let topMerchant: MerchantData | null = null;
  merchantMap.forEach(merchant => {
    if (!topMerchant || merchant.total > topMerchant.total) {
      topMerchant = merchant;
    }
  });

  return topMerchant;
}

export function getWeeklyBreakdown(transactions: Transaction[], month: number, year: number): WeeklyData[] {
  const weeks: WeeklyData[] = [
    { week: 1, label: '1-7', amount: 0 },
    { week: 2, label: '8-14', amount: 0 },
    { week: 3, label: '15-21', amount: 0 },
    { week: 4, label: '22+', amount: 0 },
  ];

  expensesOnly(transactions).forEach(t => {
    const day = t.purchaseDate.getDate();
    if (day <= 7) weeks[0].amount += t.chargeAmount;
    else if (day <= 14) weeks[1].amount += t.chargeAmount;
    else if (day <= 21) weeks[2].amount += t.chargeAmount;
    else weeks[3].amount += t.chargeAmount;
  });

  return weeks;
}

export function getDailyBreakdown(transactions: Transaction[], month: number, year: number): DailyData[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dailyData: DailyData[] = [];
  const expenses = expensesOnly(transactions);

  for (let day = 1; day <= daysInMonth; day++) {
    const dayTransactions = expenses.filter(t =>
      t.purchaseDate.getDate() === day
    );
    const amount = dayTransactions.reduce((sum, t) => sum + t.chargeAmount, 0);
    dailyData.push({
      day,
      date: `${day}`,
      amount,
    });
  }

  return dailyData;
}

export function getMonthlyBreakdown(transactions: Transaction[], year: number): { month: string; amount: number; monthIndex: number }[] {
  const hebrewMonths = [
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
  ];
  const expenses = expensesOnly(transactions);

  const monthlyData = hebrewMonths.map((name, index) => {
    const monthTransactions = expenses.filter(t =>
      t.statementDate.getMonth() === index && t.statementDate.getFullYear() === year
    );
    return {
      month: name,
      monthIndex: index,
      amount: monthTransactions.reduce((sum, t) => sum + t.chargeAmount, 0),
    };
  });

  return monthlyData;
}

export function getMonthlyTrend(transactions: Transaction[], year: number): { month: string; amount: number }[] {
  return getMonthlyBreakdown(transactions, year).map(m => ({
    month: m.month,
    amount: m.amount,
  }));
}

export function findRecurrentPayments(transactions: Transaction[]): RecurrentPayment[] {
  const merchantMonthlyData = new Map<string, Map<string, number>>();

  // Group transactions by merchant and statement-month, SUMMING amounts
  expensesOnly(transactions).forEach(t => {
    const monthKey = `${t.statementDate.getFullYear()}-${t.statementDate.getMonth() + 1}`;
    
    if (!merchantMonthlyData.has(t.merchantName)) {
      merchantMonthlyData.set(t.merchantName, new Map());
    }
    
    const monthMap = merchantMonthlyData.get(t.merchantName)!;
    const currentSum = monthMap.get(monthKey) || 0;
    monthMap.set(monthKey, currentSum + t.chargeAmount);
  });

  const recurrentPayments: RecurrentPayment[] = [];

  merchantMonthlyData.forEach((monthMap, merchantName) => {
    // Check if we have data for at least 3 distinct months
    if (monthMap.size >= 3) {
      const amounts: number[] = [];
      const months: string[] = [];

      monthMap.forEach((monthlyTotal, monthKey) => {
        amounts.push(monthlyTotal);
        months.push(monthKey);
      });

      // Calculate average of the MONTHLY TOTALS
      const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      
      // Check if monthly totals are similar (within 20% of average)
      const isSimilar = amounts.every(a => Math.abs(a - avgAmount) / avgAmount < 0.2);

      if (isSimilar) {
        recurrentPayments.push({
          merchantName,
          averageAmount: avgAmount,
          months,
          frequency: months.length,
        });
      }
    }
  });

  return recurrentPayments.sort((a, b) => b.frequency - a.frequency);
}

export function getTopMerchants(transactions: Transaction[], limit: number = 5): MerchantData[] {
  const merchantMap = new Map<string, MerchantData>();

  expensesOnly(transactions).forEach(t => {
    const existing = merchantMap.get(t.merchantName) || { name: t.merchantName, total: 0, count: 0 };
    existing.total += t.chargeAmount;
    existing.count += 1;
    merchantMap.set(t.merchantName, existing);
  });

  return Array.from(merchantMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function filterTransactionsByPeriod(
  transactions: Transaction[],
  month: number | null,
  year: number
): Transaction[] {
  return transactions.filter(t => {
    const tYear = t.statementDate.getFullYear();
    const tMonth = t.statementDate.getMonth();

    if (month === null) {
      return tYear === year;
    }
    return tYear === year && tMonth === month;
  });
}

export function getAvailableYears(transactions: Transaction[]): number[] {
  const years = new Set<number>();
  transactions.forEach(t => years.add(t.statementDate.getFullYear()));
  return Array.from(years).sort((a, b) => b - a);
}

export function getAvailableMonths(transactions: Transaction[], year: number): number[] {
  const months = new Set<number>();
  transactions
    .filter(t => t.statementDate.getFullYear() === year)
    .forEach(t => months.add(t.statementDate.getMonth()));
  return Array.from(months).sort((a, b) => a - b);
}

export function getCategoryBreakdown(transactions: Transaction[]): { name: string; value: number }[] {
  const categoryMap = new Map<string, number>();

  expensesOnly(transactions).forEach(t => {
    const category = t.category || 'אחר';
    const current = categoryMap.get(category) || 0;
    categoryMap.set(category, current + t.chargeAmount);
  });

  return Array.from(categoryMap.entries())
    .map(([name, value]) => ({ name, value }))
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value);
}

