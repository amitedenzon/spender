# Soft-Delete Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to hide individual transactions so they are excluded from all analytics, with a restore section in the Data Management page.

**Architecture:** A `Set<string>` of hidden transaction IDs lives in `App.tsx` state, backed by `localStorage` key `hidden_transactions`. A `visibleTransactions` derived value filters out hidden IDs and is passed to all analytics routes. `DataManagement` receives the full transaction list plus hide/restore handlers to render a collapsible restore section.

**Tech Stack:** React 18, TypeScript, shadcn/ui (Collapsible), lucide-react (EyeOff, Eye)

---

## File Map

| File | Change |
|------|--------|
| `src/App.tsx` | Add `hiddenIds` state, handlers, `visibleTransactions`, update route props |
| `src/pages/Monitor.tsx` | Add `onHideTransaction` prop, pass to Dashboard |
| `src/components/Dashboard.tsx` | Add `onHideTransaction` prop, pass to TransactionTable |
| `src/components/TransactionTable.tsx` | Add `onHide` prop, hover-reveal EyeOff button per row |
| `src/pages/DataManagement.tsx` | Accept `transactions`/`hiddenIds`/`onRestoreTransaction` props, add hidden section |

---

## Task 1: Add hiddenIds state and handlers to App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the `loadHiddenIds` helper and state**

  In `src/App.tsx`, add the helper function directly above the `App` component declaration (after the existing `migrateStoredOverrides` function), then add the state inside `App`:

  ```ts
  // Add above the App component:
  const loadHiddenIds = (): Set<string> => {
    try {
      const saved = localStorage.getItem('hidden_transactions');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  };
  ```

  Inside the `App` component body, after the existing `const [isLoading, setIsLoading] = useState(false);` line:

  ```ts
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(loadHiddenIds);
  ```

- [ ] **Step 2: Add `handleHideTransaction` and `handleRestoreTransaction` callbacks**

  Add both after the existing `handleFilesSelected` callback (around line 275):

  ```ts
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
  ```

- [ ] **Step 3: Verify the app still compiles**

  ```bash
  npm run build 2>&1 | tail -20
  ```
  Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src/App.tsx
  git commit -m "feat: add hiddenIds state and hide/restore handlers to App"
  ```

---

## Task 2: Add visibleTransactions and update route props

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `visibleTransactions` derived value**

  Add this `useMemo` after the existing `insightsStore` and `autoLabeledRef` declarations, around line 104:

  ```ts
  const visibleTransactions = useMemo(
    () => transactions.filter(t => !hiddenIds.has(t.id)),
    [transactions, hiddenIds]
  );
  ```

  Add `useMemo` to the import at the top if not already present (it is already imported).

- [ ] **Step 2: Update route props**

  In the `<Routes>` block, make these changes:

  **`/monitor` route** — swap `transactions` for `visibleTransactions` and add `onHideTransaction`:
  ```tsx
  <Monitor
    transactions={visibleTransactions}
    onCategoryChange={handleCategoryChange}
    onBatchCategoryChange={handleBatchCategoryChange}
    onHideTransaction={handleHideTransaction}
  />
  ```

  **`/recurring` route** — swap `transactions` for `visibleTransactions`:
  ```tsx
  <RecurringPaymentsPage transactions={visibleTransactions} />
  ```

  **`/statistics` route** — swap `transactions` for `visibleTransactions`:
  ```tsx
  <Statistics transactions={visibleTransactions} insightsStore={insightsStore} />
  ```

  **`/data` route** — add the three new props:
  ```tsx
  <DataManagement
    transactions={transactions}
    hiddenIds={hiddenIds}
    onRestoreTransaction={handleRestoreTransaction}
  />
  ```

- [ ] **Step 3: Verify the app compiles (it will error on Monitor/DataManagement prop mismatch — that's expected)**

  ```bash
  npm run build 2>&1 | grep "error TS"
  ```
  Expected: errors about `onHideTransaction` not existing on MonitorProps and new DataManagement props — these are fixed in Tasks 3 and 5.

- [ ] **Step 4: Commit**

  ```bash
  git add src/App.tsx
  git commit -m "feat: derive visibleTransactions and update route props"
  ```

---

## Task 3: Thread onHideTransaction through Monitor → Dashboard

**Files:**
- Modify: `src/pages/Monitor.tsx`
- Modify: `src/components/Dashboard.tsx`

- [ ] **Step 1: Update `MonitorProps` and pass-through in Monitor.tsx**

  Replace the entire `MonitorProps` interface and the `Monitor` function signature:

  ```ts
  interface MonitorProps {
    transactions: Transaction[];
    onCategoryChange: (id: string, newCategory: string) => void;
    onBatchCategoryChange?: (merchantCategoryMap: Map<string, string>) => void;
    onHideTransaction?: (id: string) => void;
  }

  const Monitor = ({ transactions, onCategoryChange, onBatchCategoryChange, onHideTransaction }: MonitorProps) => {
  ```

  Update the `<Dashboard>` render call (currently around line 32):

  ```tsx
  return (
    <Dashboard
      transactions={transactions}
      onCategoryChange={onCategoryChange}
      onBatchCategoryChange={onBatchCategoryChange}
      onHideTransaction={onHideTransaction}
    />
  );
  ```

- [ ] **Step 2: Update `DashboardProps` and pass-through in Dashboard.tsx**

  In `src/components/Dashboard.tsx`, update the `DashboardProps` interface (around line 51):

  ```ts
  interface DashboardProps {
    transactions: Transaction[];
    onCategoryChange: (id: string, newCategory: string) => void;
    onBatchCategoryChange?: (merchantCategoryMap: Map<string, string>) => void;
    onHideTransaction?: (id: string) => void;
  }
  ```

  Update the destructuring in the `Dashboard` function signature (around line 62):

  ```ts
  export function Dashboard({ transactions, onCategoryChange, onBatchCategoryChange, onHideTransaction }: DashboardProps) {
  ```

  Update the `<TransactionTable>` render call (around line 332):

  ```tsx
  <TransactionTable
    transactions={filteredTransactions}
    onCategoryChange={onCategoryChange}
    onBatchCategoryChange={onBatchCategoryChange}
    onHide={onHideTransaction}
  />
  ```

- [ ] **Step 3: Verify compilation**

  ```bash
  npm run build 2>&1 | grep "error TS"
  ```
  Expected: errors only about `onHide` not existing on `TransactionTableProps` and DataManagement props — fixed in Tasks 4 and 5.

- [ ] **Step 4: Commit**

  ```bash
  git add src/pages/Monitor.tsx src/components/Dashboard.tsx
  git commit -m "feat: thread onHideTransaction through Monitor and Dashboard"
  ```

---

## Task 4: Add hide button to TransactionTable rows

**Files:**
- Modify: `src/components/TransactionTable.tsx`

- [ ] **Step 1: Update imports**

  In `src/components/TransactionTable.tsx`, update the lucide-react import line to add `EyeOff`:

  ```ts
  import { Search, ArrowUpDown, Calendar, Store, CreditCard, Repeat, Sparkles, Loader2, EyeOff } from 'lucide-react';
  ```

- [ ] **Step 2: Add `onHide` to the props interface**

  Update `TransactionTableProps`:

  ```ts
  interface TransactionTableProps {
    transactions: Transaction[];
    onCategoryChange: (id: string, newCategory: string) => void;
    onBatchCategoryChange?: (merchantCategoryMap: Map<string, string>) => void;
    onHide?: (id: string) => void;
  }
  ```

  Update the function signature to destructure `onHide`:

  ```ts
  export function TransactionTable({ transactions, onCategoryChange, onBatchCategoryChange, onHide }: TransactionTableProps) {
  ```

- [ ] **Step 3: Add a hide button column to the table header**

  The current `<TableHeader>` has 5 columns (תאריך, בית עסק, סוג, סכום, פירוט). Add a conditional 6th empty header cell at the end (after `<TableHead className="text-right">פירוט</TableHead>`):

  ```tsx
  {onHide && <TableHead className="w-8" />}
  ```

  Also update the empty-state row's `colSpan` so it spans all columns:

  ```tsx
  <TableCell colSpan={onHide ? 6 : 5} className="text-center py-8 text-muted-foreground">
    לא נמצאו עסקאות
  </TableCell>
  ```

- [ ] **Step 4: Add the EyeOff button to each row**

  In the row render (the `filteredAndSorted.map` block), add a new `<TableCell>` after the existing "פירוט" cell:

  ```tsx
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
  ```

  Also add `group` to the `<TableRow>` className so the hover-reveal works:

  ```tsx
  <TableRow key={t.id} className="group hover:bg-muted/30 transition-colors">
  ```

- [ ] **Step 5: Verify compilation**

  ```bash
  npm run build 2>&1 | grep "error TS"
  ```
  Expected: only DataManagement prop errors remain.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/TransactionTable.tsx
  git commit -m "feat: add hover-reveal hide button to transaction table rows"
  ```

---

## Task 5: Refactor DataManagement — accept props and add hidden section

**Files:**
- Modify: `src/pages/DataManagement.tsx`

- [ ] **Step 1: Update imports**

  Replace the existing import block at the top of `src/pages/DataManagement.tsx`:

  ```ts
  import { useState, useEffect } from 'react';
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
  } from "@/components/ui/table";
  import { Button } from "@/components/ui/button";
  import { Trash2, Download, FileText, Database, Eye, ChevronDown } from "lucide-react";
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  } from "@/components/ui/alert-dialog";
  import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
  } from "@/components/ui/collapsible";
  import { Badge } from "@/components/ui/badge";
  import { toast } from "sonner";
  import { format } from "date-fns";
  import { Transaction } from "@/types/transaction";
  ```

- [ ] **Step 2: Add props interface and update component signature**

  Add the interface after the existing `FileData` interface:

  ```ts
  interface DataManagementProps {
    transactions: Transaction[];
    hiddenIds: Set<string>;
    onRestoreTransaction: (id: string) => void;
  }
  ```

  Update the component signature:

  ```ts
  export default function DataManagement({ transactions, hiddenIds, onRestoreTransaction }: DataManagementProps) {
  ```

- [ ] **Step 3: Add `isHiddenOpen` state inside the component**

  After the existing `const [fileToDelete, setFileToDelete] = useState<string | null>(null);` line:

  ```ts
  const [isHiddenOpen, setIsHiddenOpen] = useState(false);
  ```

- [ ] **Step 4: Derive the hidden transactions list**

  After the state declarations, add:

  ```ts
  const hiddenTransactions = transactions.filter(t => hiddenIds.has(t.id));
  ```

- [ ] **Step 5: Add the hidden transactions section to the JSX**

  Add this block after the closing `</div>` of the files table card (after the `</div>` that closes `className="bg-card rounded-lg overflow-hidden"`), and before the `<AlertDialog>`:

  ```tsx
  {hiddenTransactions.length > 0 && (
    <Collapsible open={isHiddenOpen} onOpenChange={setIsHiddenOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground w-full justify-start px-0"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${isHiddenOpen ? 'rotate-180' : ''}`} />
          <span>עסקאות מוסתרות</span>
          <Badge variant="secondary" className="tabular-nums">{hiddenTransactions.length}</Badge>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="bg-card rounded-lg overflow-hidden mt-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-right">תאריך</TableHead>
                <TableHead className="text-right">בית עסק</TableHead>
                <TableHead className="text-right">סכום</TableHead>
                <TableHead className="text-center w-[80px]">שחזור</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hiddenTransactions.map(t => (
                <TableRow key={t.id} className="hover:bg-muted/40 transition-colors opacity-60">
                  <TableCell className="tabular-nums text-sm">
                    {t.purchaseDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                  </TableCell>
                  <TableCell>{t.merchantName}</TableCell>
                  <TableCell className="tabular-nums text-sm">
                    {t.chargeAmount.toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:text-primary"
                      onClick={() => onRestoreTransaction(t.id)}
                      title="שחזר עסקה"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )}
  ```

- [ ] **Step 6: Verify full compilation with no errors**

  ```bash
  npm run build 2>&1 | tail -30
  ```
  Expected: clean build, no TypeScript errors.

- [ ] **Step 7: Commit**

  ```bash
  git add src/pages/DataManagement.tsx
  git commit -m "feat: add hidden transactions restore section to DataManagement"
  ```

---

## Task 6: Manual verification

- [ ] **Step 1: Start the dev server**

  ```bash
  npm run dev
  ```
  Open `http://localhost:5173`.

- [ ] **Step 2: Verify hide button appears on hover**

  Navigate to `/monitor`. Hover over any transaction row — an `EyeOff` icon should appear at the end of the row. Click it.

- [ ] **Step 3: Verify the hidden transaction disappears from analytics**

  After hiding a transaction: the total spending metric on the dashboard should decrease by that transaction's amount. The category pie and charts should no longer include it.

- [ ] **Step 4: Verify hidden section appears in Data Management**

  Navigate to `/data`. A "עסקאות מוסתרות (1)" collapsible button should be visible. Click to expand — the hidden transaction should appear in the table with a restore (`Eye`) button.

- [ ] **Step 5: Verify restore works**

  Click the restore button on the hidden transaction in `/data`. Navigate back to `/monitor` — the transaction should reappear and the totals should be restored.

- [ ] **Step 6: Verify persistence across reload**

  Hide a transaction, reload the page (`Cmd+R`). The transaction should still be hidden (persisted in localStorage). Restore it from `/data`.

- [ ] **Step 7: Final commit**

  ```bash
  git add -p  # confirm nothing unintended is staged
  git commit -m "feat: soft-delete transactions with hide/restore"
  ```
