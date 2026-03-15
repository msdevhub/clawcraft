import { useCallback, useRef, useState } from 'react';

interface HoldButtonProps {
  label: string;
  holdMs?: number;
  onComplete: () => void;
  className?: string;
  disabled?: boolean;
}

/** Hold-to-confirm button. Shows fill progress while holding. */
export function HoldButton({ label, holdMs = 1200, onComplete, className = '', disabled }: HoldButtonProps) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);

  const start = useCallback(() => {
    if (disabled) return;
    setHolding(true);
    startRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const p = Math.min(1, elapsed / holdMs);
      setProgress(p);
      if (p >= 1) {
        stop();
        onComplete();
      }
    }, 30);
  }, [disabled, holdMs, onComplete]);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setHolding(false);
    setProgress(0);
  }, []);

  return (
    <button
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      disabled={disabled}
      className={`relative overflow-hidden select-none ${className}`}
    >
      {/* Fill progress */}
      {holding && (
        <div
          className="absolute inset-0 bg-red-500/30 transition-none"
          style={{ width: `${progress * 100}%` }}
        />
      )}
      <span className="relative z-10">{holding ? `${Math.round(progress * 100)}%` : label}</span>
    </button>
  );
}
