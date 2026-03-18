import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  viewportClassName?: string;
}

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  { className, viewportClassName, children, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn('relative overflow-hidden', className)} {...props}>
      <div className={cn('scrollbar-thin h-full overflow-auto pr-2', viewportClassName)}>{children}</div>
    </div>
  );
});
