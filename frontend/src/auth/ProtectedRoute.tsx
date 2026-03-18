import { useLogto } from '@logto/react';
import { type ReactNode, useEffect } from 'react';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, signIn } = useLogto();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      void signIn(window.location.origin + '/callback');
    }
  }, [isLoading, isAuthenticated, signIn]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-300">
        <span className="animate-pulse text-2xl">⏳ 加载中...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-300">
        <span className="animate-pulse text-2xl">🔐 正在跳转登录...</span>
      </div>
    );
  }

  return <>{children}</>;
}
