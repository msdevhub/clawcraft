import * as React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'muted';
}

const tones = {
  default: 'border-sky-400/30 bg-sky-400/10 text-sky-100',
  success: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100',
  warning: 'border-amber-300/30 bg-amber-400/10 text-amber-100',
  danger: 'border-rose-300/30 bg-rose-400/10 text-rose-100',
  muted: 'border-slate-700/70 bg-slate-900/70 text-slate-300',
};

export function Badge({ className, tone = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
