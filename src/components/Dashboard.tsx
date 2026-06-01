import { useMemo, useState } from 'react';
import { CreditCard, TrendingDown, Calendar, Store, Repeat, Wallet, TrendingUp, BarChart2 } from 'lucide-react';
import { Transaction, ViewMode } from '@/types/transaction';
import { MetricCard } from './MetricCard';
import { ViewToggle } from './ViewToggle';
import { PeriodSelector } from './PeriodSelector';
import { ChartCard } from './ChartCard';
import { WeeklyPieChart } from './charts/WeeklyPieChart';
import { DailyBarChart } from './charts/DailyBarChart';
import { MonthlyPieChart } from './charts/MonthlyPieChart';
import { TrendLineChart } from './charts/TrendLineChart';
import { TransactionTable } from './TransactionTable';
import { TopMerchants } from './TopMerchants';
import { CategoryPieChart } from './charts/CategoryPieChart';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CATEGORIES } from '@/utils/categories';
import { Filter } from 'lucide-react';
import {
  calculateTotalSpending,
  calculateStandingOrdersTotal,
  calculateIncomeTotal,
  calculateInvestmentTotal,
  countIncomeTransactions,
  getTopMerchant,
  getWeeklyBreakdown,
  getDailyBreakdown,
  getMonthlyBreakdown,
  getMonthlyTrend,
  getTopMerchants,
  filterTransactionsByPeriod,
  getAvailableYears,
  getAvailableMonths,
  getCategoryBreakdown,
  getRecurringMerchantNames,
} from '@/utils/analytics';

interface DashboardProps {
  transactions: Transaction[];
  onCategoryChange: (id: string, newCategory: string) => void;
  onBatchCategoryChange?: (merchantCategoryMap: Map<string, string>) => void;
}

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
];

export function Dashboard({ transactions, onCategoryChange, onBatchCategoryChange }: DashboardProps) {
  const availableYears = useMemo(() => getAvailableYears(transactions), [transactions]);
  const [selectedYear, setSelectedYear] = useState(availableYears[0] || new Date().getFullYear());
  
  const availableMonths = useMemo(() => 
    getAvailableMonths(transactions, selectedYear), 
    [transactions, selectedYear]
  );
  const [selectedMonth, setSelectedMonth] = useState(availableMonths[availableMonths.length - 1] ?? 0);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [pieMode, setPieMode] = useState<'time' | 'category'>('category');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  // Filtered transactions based on view mode and category
  const filteredTransactions = useMemo(() => {
    let filtered = filterTransactionsByPeriod(
      transactions, 
      viewMode === 'month' ? selectedMonth : null, 
      selectedYear
    );

    if (selectedCategory && selectedCategory !== 'all') {
      filtered = filtered.filter(t => t.category === selectedCategory);
    }

    return filtered;
  }, [transactions, viewMode, selectedMonth, selectedYear, selectedCategory]);

  // Calculate metrics
  const totalSpending = useMemo(() => 
    calculateTotalSpending(filteredTransactions), 
    [filteredTransactions]
  );

  const incomeTotal = useMemo(
    () => calculateIncomeTotal(filteredTransactions),
    [filteredTransactions]
  );

  const incomeCount = useMemo(
    () => countIncomeTransactions(filteredTransactions),
    [filteredTransactions]
  );

  const recurringMerchants = useMemo(
    () => getRecurringMerchantNames(transactions),
    [transactions]
  );

  const standingOrdersTotal = useMemo(() =>
    calculateStandingOrdersTotal(filteredTransactions, recurringMerchants),
    [filteredTransactions, recurringMerchants]
  );

  const investmentTotal = useMemo(() =>
    calculateInvestmentTotal(filteredTransactions),
    [filteredTransactions]
  );

  // Chart data
  const weeklyData = useMemo(() => 
    getWeeklyBreakdown(filteredTransactions, selectedMonth, selectedYear),
    [filteredTransactions, selectedMonth, selectedYear]
  );

  const dailyData = useMemo(() => 
    getDailyBreakdown(filteredTransactions, selectedMonth, selectedYear),
    [filteredTransactions, selectedMonth, selectedYear]
  );

  const monthlyData = useMemo(() => 
    getMonthlyBreakdown(transactions, selectedYear),
    [transactions, selectedYear]
  );

  const trendData = useMemo(() => 
    getMonthlyTrend(transactions, selectedYear),
    [transactions, selectedYear]
  );

  const categoryData = useMemo(() => 
    getCategoryBreakdown(filteredTransactions),
    [filteredTransactions]
  );

  const topMerchants = useMemo(() =>
    getTopMerchants(filteredTransactions, 6),
    [filteredTransactions]
  );

  const periodLabel = viewMode === 'month'
    ? `${HEBREW_MONTHS[selectedMonth]} ${selectedYear}`
    : `שנת ${selectedYear}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">מעקב הוצאות</h1>
          <p className="text-muted-foreground mt-1 text-sm">{periodLabel}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
             <SelectTrigger className="w-[220px] bg-background">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <SelectValue placeholder="סינון סוג" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל העסקאות</SelectItem>
              {Object.values(CATEGORIES).map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <PeriodSelector
            viewMode={viewMode}
            selectedYear={selectedYear}
            selectedMonth={selectedMonth}
            availableYears={availableYears}
            availableMonths={availableMonths}
            onYearChange={setSelectedYear}
            onMonthChange={setSelectedMonth}
          />
          <ViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="סה״כ הוצאות"
          value={totalSpending}
          icon={<CreditCard className="h-5 w-5" />}
          variant="spending"
          delay={0}
        />
        <MetricCard
          title="הכנסות"
          value={incomeTotal}
          subtitle={
            incomeCount === 0
              ? 'אין זיכויים בתקופה'
              : incomeCount === 1
                ? 'זיכוי אחד'
                : `${incomeCount} זיכויים`
          }
          icon={<TrendingUp className="h-5 w-5" />}
          variant="savings"
          delay={50}
        />
        <MetricCard
          title="השקעות"
          value={investmentTotal}
          icon={<BarChart2 className="h-5 w-5" />}
          variant="warning"
          delay={100}
        />
        <MetricCard
          title="הוראות קבע"
          value={standingOrdersTotal}
          icon={<Repeat className="h-5 w-5" />}
          variant="primary"
          delay={150}
        />
      </div>

      {/* Main charts row. 12-col grid: the main time series chart gets 7
          columns (was 6), the pie gets 3, and top-merchants/biggest deals
          slides to its own full-width row below for breathing room. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {viewMode === 'month' ? (
          <>
            <ChartCard
              title="הוצאות יומיות"
              subtitle="פעילות יומית לאורך החודש"
              delay={250}
              className="lg:col-span-6"
            >
              <DailyBarChart data={dailyData} onDayClick={setSelectedDay} />
            </ChartCard>

            <ChartCard
              title={pieMode === 'time' ? 'התפלגות שבועית' : 'התפלגות לפי קטגוריה'}
              subtitle={pieMode === 'time' ? 'הוצאות לפי שבוע בחודש' : 'הוצאות לפי סוג'}
              delay={300}
              className="lg:col-span-6"
              action={
                <Tabs value={pieMode} onValueChange={(v) => setPieMode(v as 'time' | 'category')} className="w-[100px]">
                  <TabsList className="grid w-full grid-cols-2 h-8">
                    <TabsTrigger value="time" className="text-xs px-1">זמן</TabsTrigger>
                    <TabsTrigger value="category" className="text-xs px-1">סוג</TabsTrigger>
                  </TabsList>
                </Tabs>
              }
            >
              {pieMode === 'time' ? (
                <WeeklyPieChart data={weeklyData} />
              ) : (
                <CategoryPieChart
                  data={categoryData}
                  onCategoryClick={(category) => setSelectedCategory(category)}
                />
              )}
            </ChartCard>
          </>
        ) : (
          <>
            <ChartCard
              title="מגמת הוצאות"
              subtitle="התפתחות ההוצאות לאורך השנה"
              delay={250}
              className="lg:col-span-6"
            >
              <TrendLineChart data={trendData} />
            </ChartCard>

            <ChartCard
              title={pieMode === 'time' ? 'התפלגות חודשית' : 'התפלגות לפי קטגוריה'}
              subtitle={pieMode === 'time' ? 'הוצאות לפי חודש (לחץ למעבר)' : 'הוצאות לפי סוג'}
              delay={300}
              className="lg:col-span-6"
              action={
                <Tabs value={pieMode} onValueChange={(v) => setPieMode(v as 'time' | 'category')} className="w-[100px]">
                  <TabsList className="grid w-full grid-cols-2 h-8">
                    <TabsTrigger value="time" className="text-xs px-1">זמן</TabsTrigger>
                    <TabsTrigger value="category" className="text-xs px-1">סוג</TabsTrigger>
                  </TabsList>
                </Tabs>
              }
            >
              {pieMode === 'time' ? (
                <MonthlyPieChart
                  data={monthlyData}
                  onMonthClick={(monthName) => {
                    const monthIndex = HEBREW_MONTHS.indexOf(monthName);
                    if (monthIndex !== -1) {
                      setSelectedMonth(monthIndex);
                      setViewMode('month');
                    }
                  }}
                />
              ) : (
                <CategoryPieChart
                  data={categoryData}
                  onCategoryClick={(category) => setSelectedCategory(category)}
                />
              )}
            </ChartCard>
          </>
        )}
      </div>

      {/* Top merchants gets its own row — previously squeezed at 25% width,
          which truncated names and made the bars look stubby. */}
      <ChartCard
        title="בתי עסק מובילים"
        subtitle="6 בתי העסק עם ההוצאות הגבוהות ביותר"
        delay={350}
      >
        <TopMerchants merchants={topMerchants} />
      </ChartCard>

      {/* Transaction Table */}
      <TransactionTable
        transactions={filteredTransactions}
        onCategoryChange={onCategoryChange}
        onBatchCategoryChange={onBatchCategoryChange}
      />

      <DayDetailDialog
        day={selectedDay}
        month={selectedMonth}
        year={selectedYear}
        transactions={filteredTransactions}
        onClose={() => setSelectedDay(null)}
      />
    </div>
  );
}

interface DayDetailDialogProps {
  day: number | null;
  month: number;
  year: number;
  transactions: Transaction[];
  onClose: () => void;
}

function DayDetailDialog({ day, month, year, transactions, onClose }: DayDetailDialogProps) {
  const dayTransactions = useMemo(() => {
    if (day == null) return [];
    return transactions
      .filter(t =>
        t.purchaseDate.getDate() === day &&
        t.purchaseDate.getMonth() === month &&
        t.purchaseDate.getFullYear() === year
      )
      .sort((a, b) => b.chargeAmount - a.chargeAmount);
  }, [day, month, year, transactions]);

  const total = useMemo(
    () => dayTransactions.reduce((sum, t) => sum + t.chargeAmount, 0),
    [dayTransactions]
  );

  const formatCurrency = (n: number) =>
    n.toLocaleString('he-IL', { style: 'currency', currency: 'ILS' });

  return (
    <Dialog open={day != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>
            {day != null && `${day} ${HEBREW_MONTHS[month]} ${year}`}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {dayTransactions.length === 0
              ? 'אין עסקאות ביום זה'
              : `${dayTransactions.length} עסקאות · סה״כ ${formatCurrency(total)}`}
          </p>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto -mx-6 px-6">
          {dayTransactions.length > 0 && (
            <ul className="divide-y divide-border">
              {dayTransactions.map(t => (
                <li key={t.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground break-words">{t.merchantName}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">{t.category}</Badge>
                      {t.isStandingOrder && (
                        <Badge variant="outline" className="text-xs">הוראת קבע</Badge>
                      )}
                      {t.installments && (
                        <Badge variant="outline" className="text-xs">
                          תשלום {t.installments.current}/{t.installments.total}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-sm font-semibold whitespace-nowrap">
                    {formatCurrency(t.chargeAmount)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
