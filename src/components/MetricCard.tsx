import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  variant?: 'default' | 'spending' | 'savings' | 'primary' | 'warning';
  delay?: number;
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon,
  variant = 'default',
  delay = 0,
}: MetricCardProps) {
  // Soft tinted background + colored value to bring back the
  // red-expenses / green-income / blue-recurring scheme. Background tint kept
  // very light so it still reads as "elegant" rather than marketing.
  const bg = {
    default: 'bg-card',
    spending: 'bg-spending/[0.07]',
    savings: 'bg-savings/[0.07]',
    primary: 'bg-primary/[0.07]',
    warning: 'bg-warning/[0.07]',
  }[variant];

  const valueColor = {
    default: 'text-foreground',
    spending: 'text-spending',
    savings: 'text-savings',
    primary: 'text-primary',
    warning: 'text-warning',
  }[variant];

  const iconWrap = {
    default: 'bg-muted text-muted-foreground',
    spending: 'bg-spending/15 text-spending',
    savings: 'bg-savings/15 text-savings',
    primary: 'bg-primary/15 text-primary',
    warning: 'bg-warning/15 text-warning',
  }[variant];

  return (
    <div
      className={cn(
        'rounded-lg p-4 animate-slide-up',
        bg
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground mb-1.5">{title}</p>
          <p className={cn('text-3xl font-semibold tracking-tight tabular-nums', valueColor)}>
            {typeof value === 'number'
              ? value.toLocaleString('he-IL', {
                  style: 'currency',
                  currency: 'ILS',
                  maximumFractionDigits: 0,
                })
              : value}
          </p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        {icon && (
          <div className={cn('w-9 h-9 rounded-md flex items-center justify-center shrink-0', iconWrap)}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
