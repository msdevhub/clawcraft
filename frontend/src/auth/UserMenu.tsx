import { useLogto } from '@logto/react';
import { useEffect, useState } from 'react';
import type { IdTokenClaims } from '@logto/react';

export function UserMenu() {
  const { isAuthenticated, getIdTokenClaims, signOut } = useLogto();
  const [claims, setClaims] = useState<IdTokenClaims | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      void getIdTokenClaims().then((c) => {
        if (c) setClaims(c);
      });
    }
  }, [isAuthenticated, getIdTokenClaims]);

  if (!isAuthenticated || !claims) return null;

  const displayName = claims.name || claims.username || claims.sub;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-slate-300 truncate max-w-[120px]" title={displayName}>
        👤 {displayName}
      </span>
      <button
        onClick={() => void signOut(window.location.origin)}
        className="rounded-lg border border-slate-700/50 bg-slate-800/60 px-2 py-1 text-xs text-slate-400 hover:bg-slate-700/60 hover:text-slate-200 transition-colors"
      >
        登出
      </button>
    </div>
  );
}
