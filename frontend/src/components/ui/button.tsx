import * as React from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'outline';
type ButtonSize = 'default' | 'sm' | 'icon';

const variants: Record<ButtonVariant, string> = {
  default:
    'bg-sky-400/90 text-slate-950 shadow-[0_12px_30px_rgba(69,181,255,0.24)] hover:bg-sky-300 focus-visible:outline-sky-300',
  secondary: 'bg-emerald-300/90 text-slate-950 hover:bg-emerald-200 focus-visible:outline-emerald-200',
  ghost: 'bg-transparent text-slate-200 hover:bg-slate-800/70 focus-visible:outline-slate-500',
  outline:
    'border border-slate-700/80 bg-slate-950/35 text-slate-200 hover:border-sky-400/40 hover:bg-slate-900/80 focus-visible:outline-sky-300',
};

const sizes: Record<ButtonSize, string> = {
  default: 'h-11 px-4 py-2',
  sm: 'h-9 px-3 text-sm',
  icon: 'h-10 w-10',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'default', size = 'default', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-2xl font-semibold transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
