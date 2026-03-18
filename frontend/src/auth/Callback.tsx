import { useHandleSignInCallback } from '@logto/react';
import { useNavigate } from 'react-router-dom';

export function Callback() {
  const navigate = useNavigate();
  const { isLoading } = useHandleSignInCallback(() => navigate('/'));

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-300">
        <span className="animate-pulse text-2xl">🔐 登录中...</span>
      </div>
    );
  }

  return null;
}
