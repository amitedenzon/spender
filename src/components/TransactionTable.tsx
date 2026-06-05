import { useState, useMemo } from 'react';
import { Search, ArrowUpDown, Calendar, Store, CreditCard, Repeat, Sparkles, Loader2, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Transaction } from '@/types/transaction';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CATEGORIES } from '@/utils/categories';
import { categorizeTransactionsWithAI } from '@/utils/ai';
import { toast } from 'sonner';

interface TransactionTableProps {
  transactions: Transaction[];
  onCategoryChange: (id: string, newCategory: string) => void;
  onBatchCategoryChange?: (merchantCategoryMap: Map<string, string>) => void;
  onHide?: (id: string) => void;
}

type SortField = 'date' | 'merchant' | 'amount';
type SortDirection = 'asc' | 'desc';

export function TransactionTable({ transactions, onCategoryChange, onBatchCategoryChange, onHide }: TransactionTableProps) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0 });

  const handleAIClick = async () => {
    if (!onBatchCategoryChange) return;
    
    setIsAIProcessing(true);
    setAiProgress({ current: 0, total: 0 });
    
    try {
      const result = await categorizeTransactionsWithAI(
        transactions, 
        (current, total) => setAiProgress({ current, total })
      );
      
      onBatchCategoryChange(result);
      toast.success(`סווגו בהצלחה ${result.size} בתי עסק`);
    } catch (error) {
      console.error('AI Categorization failed', error);
      toast.error('שגיאה בסיווג האוטומטי');
    } finally {
      setIsAIProcessing(false);
    }
  };
  
  // ... (useMemo filteredAndSorted)
  const filteredAndSorted = useMemo(() => {
    let filtered = transactions;

    if (search.trim()) {
      const query = search.toLowerCase();
      filtered = filtered.filter(t =>
        t.merchantName.toLowerCase().includes(query) ||
        t.additionalInfo.toLowerCase().includes(query)
      );
    }

    return [...filtered].sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1;
      
      switch (sortField) {
        case 'date':
          return (a.purchaseDate.getTime() - b.purchaseDate.getTime()) * direction;
        case 'merchant':
          return a.merchantName.localeCompare(b.merchantName, 'he') * direction;
        case 'amount':
          return (a.chargeAmount - b.chargeAmount) * direction;
        default:
          return 0;
      }
    });
  }, [transactions, search, sortField, sortDirection]);

  // ... (filteredTotal)
  const filteredTotal = useMemo(() => {
    return filteredAndSorted.reduce((sum, t) => sum + t.chargeAmount, 0);
  }, [filteredAndSorted]);

  // ... (toggleSort)
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };
  
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit'
    });
  };

  return (
    <div className="bg-card rounded-lg overflow-hidden animate-slide-up" style={{ animationDelay: '400ms' }}>
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="חיפוש לפי שם בית עסק..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-10 bg-background"
            />
          </div>
          
          {onBatchCategoryChange && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleAIClick} 
              disabled={isAIProcessing}
              className="gap-2 rtl:flex-row-reverse"
            >
              {isAIProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{aiProgress.current}/{aiProgress.total}</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 text-purple-500" />
                  <span className="hidden sm:inline">סיווג AI</span>
                </>
              )}
            </Button>
          )}

          <Badge variant="secondary" className="whitespace-nowrap flex gap-2">
            <span>{filteredAndSorted.length} עסקאות</span>
             {/* ... rest of badge ... */}
            {search.trim() && (
              <>
                <span className="opacity-50">|</span>
                <span className="text-primary font-bold">
                  {filteredTotal.toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}
                </span>
              </>
            )}
          </Badge>
        </div>
      </div>

      <div className="overflow-auto max-h-[520px]">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleSort('date')}
              >
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  תאריך
                  <ArrowUpDown className="h-3 w-3" />
                </div>
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleSort('merchant')}
              >
                <div className="flex items-center gap-2">
                  <Store className="h-4 w-4" />
                  בית עסק
                  <ArrowUpDown className="h-3 w-3" />
                </div>
              </TableHead>
              <TableHead className="text-right">סוג</TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleSort('amount')}
              >
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  סכום
                  <ArrowUpDown className="h-3 w-3" />
                </div>
              </TableHead>
              <TableHead className="text-right">פירוט</TableHead>
              {onHide && <TableHead className="w-8" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={onHide ? 6 : 5} className="text-center py-8 text-muted-foreground">
                  לא נמצאו עסקאות
                </TableCell>
              </TableRow>
            ) : (
              filteredAndSorted.map((t) => (
                <TableRow key={t.id} className="group hover:bg-muted/30 transition-colors">
                  <TableCell className="font-medium tabular-nums">
                    {formatDate(t.purchaseDate)}
                  </TableCell>
                  <TableCell>{t.merchantName}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="outline-none">
                        <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-secondary text-secondary-foreground whitespace-nowrap hover:bg-secondary/80 cursor-pointer transition-colors">
                          {t.category || 'אחר'}
                        </span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="max-h-[300px] overflow-auto">
                        {Object.values(CATEGORIES).map((cat) => (
                          <DropdownMenuItem 
                            key={cat}
                            onClick={() => onCategoryChange(t.id, cat)}
                            className={cn(
                              "cursor-pointer text-right justify-end",
                              t.category === cat && "bg-muted font-medium"
                            )}
                          >
                            {cat}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                  <TableCell className={cn(
                    "font-bold tabular-nums",
                    t.chargeAmount > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"
                  )}>
                    {t.chargeAmount.toLocaleString('he-IL', { 
                      style: 'currency', 
                      currency: 'ILS' 
                    })}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm max-w-[260px] break-words" title={t.additionalInfo}>
                    {t.additionalInfo}
                    {t.isStandingOrder && (
                      <Badge variant="outline" className="mr-2 gap-1 inline-flex">
                        <Repeat className="h-3 w-3" />
                        הוראת קבע
                      </Badge>
                    )}
                  </TableCell>
                  {onHide && (
                    <TableCell className="w-8 p-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        onClick={() => onHide(t.id)}
                        title="הסתר עסקה"
                      >
                        <EyeOff className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
