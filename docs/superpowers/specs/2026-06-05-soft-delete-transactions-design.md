# Soft-Delete Transactions — Design Spec

**Date:** 2026-06-05  
**Status:** Approved

## Summary

Add the ability to hide individual transactions without removing them from the source CSV data. Hidden transactions are excluded from all analytics (totals, charts, recurring detection, statistics). They can be viewed and restored from a dedicated section in the Data Management page.

## Approach

Option A — parallel `hiddenIds` Set in App state. The `Transaction` type is left untouched. A `Set<string>` of hidden IDs lives in `App.tsx` state, backed by `localStorage`. Filtering happens in one place; all downstream routes receive only visible transactions.

## Design

### 1. State & Persistence

- `App.tsx` adds `hiddenIds: Set<string>` state, initialized from `localStorage` key `hidden_transactions` (stored as a JSON array of IDs).
- `handleHideTransaction(id: string)`: adds ID to set, persists to localStorage.
- `handleRestoreTransaction(id: string)`: removes ID from set, persists to localStorage.
- Stale IDs (from deleted files) are harmless — they simply never match a loaded transaction.

### 2. Filtering

```ts
const visibleTransactions = useMemo(
  () => transactions.filter(t => !hiddenIds.has(t.id)),
  [transactions, hiddenIds]
);
```

- `/monitor`, `/recurring`, `/statistics` all receive `visibleTransactions`.
- `DataManagement` receives the full `transactions` array + `hiddenIds` + `onRestore`.

### 3. Transaction Table UI

- `TransactionTable` gains `onHide?: (id: string) => void` prop.
- Each row: a hover-revealed `EyeOff` icon button (consistent with DataManagement's hover-reveal pattern).
- No confirmation dialog — hide is immediately reversible via DataManagement.
- `EyeOff` icon signals "soft" action, not permanent deletion.

### 4. DataManagement — Hidden Transactions Section

- `DataManagement` refactored to accept props: `transactions: Transaction[]`, `hiddenIds: Set<string>`, `onRestore: (id: string) => void`.
- `App.tsx` passes these when rendering the `/data` route.
- Bottom of the page: collapsible `<Collapsible>` section titled "עסקאות מוסתרות (N)".
- Table columns: תאריך, בית עסק, סכום, restore button (`Eye` icon).
- Section hidden entirely when `hiddenIds` is empty.

## Files Touched

| File | Change |
|------|--------|
| `src/App.tsx` | Add `hiddenIds` state, `handleHide/Restore`, `visibleTransactions`, pass props to routes |
| `src/types/transaction.ts` | No change |
| `src/components/TransactionTable.tsx` | Add `onHide` prop, hover-reveal `EyeOff` button per row |
| `src/pages/DataManagement.tsx` | Accept `transactions`/`hiddenIds`/`onRestore` props, add hidden section |

## Out of Scope

- Bulk hide (e.g. hide all from a merchant) — can be added later.
- Server-side persistence of hidden state — localStorage is sufficient for a single-user personal app.
