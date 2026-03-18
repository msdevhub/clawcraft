import { useState, type ReactNode } from 'react';

interface CollapsibleSectionProps {
  icon: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function CollapsibleSection({
  icon,
  title,
  subtitle,
  children,
  defaultOpen = false,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-700/30 bg-slate-900/25">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-800/30"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-base leading-none">{icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200">{title}</p>
            {subtitle && <p className="truncate text-[10px] text-slate-500">{subtitle}</p>}
          </div>
        </div>
        <span className={`text-xs text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>
      {open && <div className="border-t border-slate-700/20 px-4 pb-4 pt-3">{children}</div>}
    </div>
  );
}
