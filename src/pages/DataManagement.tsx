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

interface FileData {
  name: string;
  transactionCount: number;
  size: number;
  lastModified: string;
}

interface DataManagementProps {
  transactions: Transaction[];
  hiddenIds: Set<string>;
  onRestoreTransaction: (id: string) => void;
}

export default function DataManagement({ transactions, hiddenIds, onRestoreTransaction }: DataManagementProps) {
  const [files, setFiles] = useState<FileData[]>([]);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [isHiddenOpen, setIsHiddenOpen] = useState(false);

  const hiddenTransactions = transactions.filter(t => hiddenIds.has(t.id));

  const fetchFiles = async () => {
    try {
      const res = await fetch('/api/files');
      if (res.ok) {
        const data = await res.json();
        // Backend now returns transactionCount and size
        setFiles(data);
      }
    } catch (error) {
      console.error('Failed to fetch files:', error);
      toast.error('שגיאה בטעינת קבצים');
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleDownload = (filename: string) => {
    // Trigger download
    const link = document.createElement('a');
    link.href = `/api/files/${filename}/download`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const confirmDelete = async () => {
    if (!fileToDelete) return;

    try {
      const res = await fetch(`/api/files/${fileToDelete}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('קובץ נמחק בהצלחה');
        fetchFiles(); // Refresh list
      } else {
        toast.error('שגיאה במחיקת הקובץ');
      }
    } catch (error) {
      console.error('Delete failed:', error);
      toast.error('שגיאה במחיקת הקובץ');
    } finally {
      setFileToDelete(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-4 animate-fade-in max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
          <Database className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">ניהול נתונים</h1>
          <p className="text-sm text-muted-foreground">
            {files.length} קבצים · {files.reduce((sum, f) => sum + (f.transactionCount || 0), 0).toLocaleString('he-IL')} עסקאות
          </p>
        </div>
      </div>

      <div className="bg-card rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[40%] text-right">שם הקובץ</TableHead>
              <TableHead className="text-right">תאריך העלאה</TableHead>
              <TableHead className="text-right">גודל</TableHead>
              <TableHead className="text-center">עסקאות</TableHead>
              <TableHead className="text-center w-[120px]">פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                  לא נמצאו קבצים במערכת
                </TableCell>
              </TableRow>
            ) : (
              files.map((file) => (
                <TableRow key={file.name} className="group hover:bg-muted/40 transition-colors">
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      {file.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm tabular-nums">
                    {file.lastModified ? format(new Date(file.lastModified), 'dd/MM/yyyy HH:mm') : '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm tabular-nums">{formatSize(file.size || 0)}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" className="tabular-nums">
                      {file.transactionCount}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDownload(file.name)}
                        title="הורד קובץ"
                        className="h-8 w-8 hover:text-primary"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setFileToDelete(file.name)}
                        title="מחק קובץ"
                        className="h-8 w-8 hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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

      <AlertDialog open={!!fileToDelete} onOpenChange={(open) => !open && setFileToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>האם אתה בטוח?</AlertDialogTitle>
            <AlertDialogDescription>
              פעולה זו תמחק את הקובץ <span className="font-bold text-foreground">{fileToDelete}</span> לצמיתות מהמערכת.
              הנתונים יוסרו גם מתצוגת העסקאות לאחר רענון.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
             {/* Right-aligned for RTL usually needs reverse order or specific justification */}
             <div className="flex gap-2 justify-end w-full"> 
                <AlertDialogCancel>ביטול</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  מחק
                </AlertDialogAction>
             </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
