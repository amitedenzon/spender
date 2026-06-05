import { Dashboard } from '@/components/Dashboard';
import { Transaction } from '@/types/transaction';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface MonitorProps {
  transactions: Transaction[];
  onCategoryChange: (id: string, newCategory: string) => void;
  onBatchCategoryChange?: (merchantCategoryMap: Map<string, string>) => void;
  onHideTransaction?: (id: string) => void;
}

const Monitor = ({ transactions, onCategoryChange, onBatchCategoryChange, onHideTransaction }: MonitorProps) => {
  const navigate = useNavigate();

  if (transactions.length === 0) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <FileQuestion className="h-16 w-16 mx-auto text-muted-foreground" />
          <h2 className="text-2xl font-bold text-foreground">אין נתונים להצגה</h2>
          <p className="text-muted-foreground">יש להעלות קבצי CSV תחילה</p>
          <Button onClick={() => navigate('/upload')} className="mt-4">
            העלה קבצים
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Dashboard
      transactions={transactions}
      onCategoryChange={onCategoryChange}
      onBatchCategoryChange={onBatchCategoryChange}
      onHideTransaction={onHideTransaction}
    />
  );
};

export default Monitor;
