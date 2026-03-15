import { useCallback, useEffect, useState } from 'react';

export function useConfig() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch('/clawcraft/config');
      const data = await response.json();

      if (!data.ok) {
        setError(data.error || '读取配置失败');
        return;
      }

      setConfig(data.config);
    } catch (err: any) {
      setError(err.message || '读取配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  return { config, loading, error, refresh };
}
