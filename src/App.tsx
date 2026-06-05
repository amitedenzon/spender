import { useState, useCallback, useEffect, useRef } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import Upload from "@/pages/Upload";
import Monitor from "@/pages/Monitor";
import RecurringPaymentsPage from "@/pages/RecurringPayments";
import Statistics from "@/pages/Statistics";
import DataManagement from "@/pages/DataManagement";
import NotFound from "./pages/NotFound";
import { Transaction } from '@/types/transaction';
import { parseMultipleCSVs } from '@/utils/csvParser';
import { CATEGORIES } from '@/utils/categories';
import { categorizeTransactionsWithAI } from '@/utils/ai';
import { getLatestStatementPeriod, getStatisticsSummary } from '@/utils/statistics';
import { useInsightsStore } from '@/hooks/useInsightsStore';
import { toast } from 'sonner';

const queryClient = new QueryClient();

// Scraped transactions arrive as JSON with ISO strings; revive Date fields.
type RawTransaction = Omit<Transaction, 'purchaseDate' | 'statementDate'> & {
  purchaseDate: string;
  statementDate: string;
};
const hydrateScraped = (raw: RawTransaction[]): Transaction[] =>
  raw.map(t => ({
    ...t,
    purchaseDate: new Date(t.purchaseDate),
    statementDate: new Date(t.statementDate),
  }));

const mergeUnique = (existing: Transaction[], incoming: Transaction[]) => {
  const seen = new Set<string>();
  const combined = [...incoming, ...existing];
  return combined.filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
};

// Renames of category labels that have shipped before. When the user has
// localStorage overrides pointing at an old label, transparently upgrade them
// to the new label so the dashboard doesn't show a stray "unknown" row.
const CATEGORY_LABEL_MIGRATIONS: Record<string, string> = {
  'פיננסים וחיסכון': 'פיננסים והעברות',
};

const migrateLabel = (label: string): string => CATEGORY_LABEL_MIGRATIONS[label] ?? label;

// Apply localStorage overrides. Merchant-level wins over per-id.
const applyCategoryOverrides = (txs: Transaction[]): Transaction[] => {
  try {
    const merchantSaved = localStorage.getItem('merchant_category_overrides');
    const merchantOverrides: Record<string, string> = merchantSaved ? JSON.parse(merchantSaved) : {};
    const idSaved = localStorage.getItem('category_overrides');
    const idOverrides: Record<string, string> = idSaved ? JSON.parse(idSaved) : {};
    return txs.map(t => {
      const newCategory = t.category ? migrateLabel(t.category) : t.category;
      const base = newCategory === t.category ? t : { ...t, category: newCategory };
      if (merchantOverrides[t.merchantName]) return { ...base, category: migrateLabel(merchantOverrides[t.merchantName]) };
      if (idOverrides[t.id]) return { ...base, category: migrateLabel(idOverrides[t.id]) };
      return base;
    });
  } catch (e) {
    console.error('Failed to load category overrides', e);
    return txs;
  }
};

// One-time pass that rewrites localStorage entries that still reference the
// pre-rename labels. Runs on app boot. Cheap and idempotent.
const migrateStoredOverrides = () => {
  try {
    for (const storageKey of ['merchant_category_overrides', 'category_overrides']) {
      const raw = localStorage.getItem(storageKey);
      if (!raw) continue;
      const parsed: Record<string, string> = JSON.parse(raw);
      let changed = false;
      for (const [k, v] of Object.entries(parsed)) {
        const migrated = migrateLabel(v);
        if (migrated !== v) {
          parsed[k] = migrated;
          changed = true;
        }
      }
      if (changed) localStorage.setItem(storageKey, JSON.stringify(parsed));
    }
  } catch (e) {
    console.warn('Override migration skipped:', e);
  }
};

const loadHiddenIds = (): Set<string> => {
  try {
    const saved = localStorage.getItem('hidden_transactions');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  } catch {
    return new Set();
  }
};

const App = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(loadHiddenIds);

  // Lifted out of the Statistics page so the cache survives navigation and the
  // boot-time prefetch can pre-warm the latest period before the user clicks in.
  const insightsStore = useInsightsStore();

  // Tracks whether the background AI auto-labeler has already run this session.
  // Without this guard the effect would re-fire every time `transactions`
  // changes (e.g. when the user reclassifies a row) and spam the classify API.
  const autoLabeledRef = useRef(false);

  // Tracks whether we've already kicked off the boot prefetch this session.
  // The latest period is computed once data lands and only ever pre-warmed
  // once — subsequent fetches require an explicit refresh.
  const prefetchedRef = useRef(false);

  useEffect(() => {
    if (prefetchedRef.current) return;
    if (transactions.length === 0) return;
    const latest = getLatestStatementPeriod(transactions);
    if (!latest) return;
    const summary = getStatisticsSummary(transactions, latest);
    if (!summary) return;
    prefetchedRef.current = true;
    insightsStore.ensure(latest, summary);
  }, [transactions, insightsStore]);

  // Run the localStorage migration once on mount, before any data loads.
  useEffect(() => {
    migrateStoredOverrides();
  }, []);

  const loadScraped = useCallback(async () => {
    try {
      const res = await fetch('/api/scraped');
      if (!res.ok) return;
      const { transactions: raw } = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) return;
      const scraped = hydrateScraped(raw);
      setTransactions(prev => applyCategoryOverrides(mergeUnique(prev, scraped)));
    } catch (error) {
      console.error('Failed to load scraped data:', error);
    }
  }, []);

  useEffect(() => {
    const loadFiles = async () => {
      try {
        const res = await fetch('/api/files');
        if (!res.ok) return;
        const filesData: { name: string, content: string }[] = await res.json();

        const fileObjects = filesData.map(f =>
          new File([f.content], f.name, { type: 'text/csv' })
        );

        if (fileObjects.length > 0) {
           const parsed = await parseMultipleCSVs(fileObjects);
           setTransactions(prev => applyCategoryOverrides(mergeUnique(prev, parsed)));
        }
      } catch (error) {
        console.error('Failed to load persisted files:', error);
      }
    };
    loadFiles();
    loadScraped();
  }, [loadScraped]);

  const handleBatchCategoryChange = useCallback((merchantCategoryMap: Map<string, string>) => {
    setTransactions(prev => {
      const updated = prev.map(t => {
        if (merchantCategoryMap.has(t.merchantName)) {
          return { ...t, category: merchantCategoryMap.get(t.merchantName)! };
        }
        return t;
      });

      // Persist merchant-level rules so they survive reloads and apply to future uploads.
      try {
        const saved = localStorage.getItem('merchant_category_overrides');
        const overrides = saved ? JSON.parse(saved) : {};
        merchantCategoryMap.forEach((category, merchant) => {
          overrides[merchant] = category;
        });
        localStorage.setItem('merchant_category_overrides', JSON.stringify(overrides));
      } catch (e) {
        console.error('Failed to save batch overrides', e);
      }

      return updated;
    });
  }, []);

  // Background AI auto-labeler. Runs once per session as soon as we have any
  // transactions. Targets only merchants currently sitting in OTHER (i.e. the
  // rule-based categorizer couldn't place them) and that don't already have a
  // user-set merchant override — we never want AI to overwrite explicit intent.
  useEffect(() => {
    if (autoLabeledRef.current) return;
    if (transactions.length === 0) return;
    autoLabeledRef.current = true;

    let cancelled = false;

    const run = async () => {
      try {
        const merchantSaved = localStorage.getItem('merchant_category_overrides');
        const merchantOverrides: Record<string, string> = merchantSaved ? JSON.parse(merchantSaved) : {};

        const candidates = new Map<string, Transaction>();
        for (const t of transactions) {
          if (t.category !== CATEGORIES.OTHER) continue;
          if (merchantOverrides[t.merchantName]) continue;
          if (!candidates.has(t.merchantName)) candidates.set(t.merchantName, t);
        }
        if (candidates.size === 0) return;

        const mapping = await categorizeTransactionsWithAI(Array.from(candidates.values()));
        if (cancelled || mapping.size === 0) return;

        // Drop any AI guess that just re-confirms OTHER — no point persisting
        // a rule that doesn't actually change anything.
        const useful = new Map<string, string>();
        mapping.forEach((cat, merchant) => {
          if (cat && cat !== CATEGORIES.OTHER) useful.set(merchant, cat);
        });
        if (useful.size === 0) return;

        handleBatchCategoryChange(useful);
        toast.success(`סווגו אוטומטית ${useful.size} בתי עסק`, {
          description: 'התווית האוטומטית פעלה ברקע על קטגוריית "אחר"',
        });
      } catch (e) {
        // Silent failure: the manual "AI sort" button in the table is still available.
        console.error('Background AI labeling failed', e);
      }
    };

    // Slight delay so the initial render finishes and the user sees the data
    // before any toast pops. 1.5s is enough to settle the layout without
    // feeling laggy.
    const t = window.setTimeout(run, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [transactions, handleBatchCategoryChange]);

  const handleCategoryChange = useCallback((id: string, newCategory: string) => {
    setTransactions(prev => {
      const target = prev.find(t => t.id === id);
      const merchantName = target?.merchantName;

      // A manual change for a single row is treated as a merchant-wide rule:
      // every existing transaction from this merchant is recategorized, and
      // the rule is persisted so future uploads inherit it too.
      const updated = prev.map(t =>
        merchantName && t.merchantName === merchantName ? { ...t, category: newCategory } : t
      );

      try {
        if (merchantName) {
          const saved = localStorage.getItem('merchant_category_overrides');
          const overrides = saved ? JSON.parse(saved) : {};
          overrides[merchantName] = newCategory;
          localStorage.setItem('merchant_category_overrides', JSON.stringify(overrides));
        }
      } catch (e) {
        console.error('Failed to save merchant category override', e);
      }

      return updated;
    });
  }, []);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    setIsLoading(true);
    try {
      const parsed = await parseMultipleCSVs(files);
      setTransactions(prev => applyCategoryOverrides(mergeUnique(prev, parsed)));
    } catch (error) {
      console.error('Error parsing CSV files:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleHideTransaction = useCallback((id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem('hidden_transactions', JSON.stringify([...next]));
      } catch (e) {
        console.error('Failed to save hidden transactions', e);
      }
      return next;
    });
  }, []);

  const handleRestoreTransaction = useCallback((id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      try {
        localStorage.setItem('hidden_transactions', JSON.stringify([...next]));
      } catch (e) {
        console.error('Failed to save hidden transactions', e);
      }
      return next;
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <div className="min-h-screen bg-background flex" dir="rtl">
            <Sidebar />
            <main className="flex-1 overflow-auto h-screen w-full">
               <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
                <Routes>
                  <Route path="/" element={<Navigate to="/upload" replace />} />
                  <Route
                    path="/upload"
                    element={
                      <Upload
                        onFilesSelected={handleFilesSelected}
                        isLoading={isLoading}
                        transactionCount={transactions.length}
                        onSync={loadScraped}
                      />
                    }
                  />
                  <Route
                    path="/monitor"
                    element={<Monitor transactions={transactions} onCategoryChange={handleCategoryChange} onBatchCategoryChange={handleBatchCategoryChange} />}
                  />
                  <Route
                    path="/recurring"
                    element={<RecurringPaymentsPage transactions={transactions} />}
                  />
                  <Route
                    path="/statistics"
                    element={<Statistics transactions={transactions} insightsStore={insightsStore} />}
                  />
                  <Route path="/data" element={<DataManagement />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
               </div>
            </main>
          </div>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
