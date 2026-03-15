import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-2xl border border-slate-700/80 bg-slate-950/65 px-4 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500 focus:border-sky-400/50',
        className,
      )}
      {...props}
    />
  );
});
