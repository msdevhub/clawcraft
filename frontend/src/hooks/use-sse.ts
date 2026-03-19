import { useEffect } from 'react';
import type { ServerDelta, WorldState } from '@/store/types';
import { useWorldStore } from '@/store/world-store';

type TokenGetter = () => Promise<string | undefined>;

async function fetchSnapshot(signal: AbortSignal, getToken: TokenGetter) {
  const token = await getToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch('/clawcraft/state', {
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch world snapshot (${response.status})`);
  }

  return (await response.json()) as WorldState;
}

export function useSSE(url: string, getToken: TokenGetter) {
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;
    let reconnectAttempt = 0;
    let snapshotController: AbortController | null = null;

    const cleanupSource = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };

    const scheduleReconnect = () => {
      cleanupSource();
      if (stopped) {
        return;
      }

      reconnectAttempt += 1;
      useWorldStore.getState().setConnected(false, undefined, reconnectAttempt);
      const delay = Math.min(30000, 1000 * 2 ** Math.max(0, reconnectAttempt - 1));
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const connect = async () => {
      if (stopped) {
        return;
      }

      cleanupSource();

      const token = await getToken();
      if (!token) {
        scheduleReconnect();
        return;
      }

      const eventUrl = new URL(url, window.location.origin);
      eventUrl.searchParams.set('token', token);
      eventSource = new EventSource(eventUrl.toString());

      eventSource.addEventListener('connected', async (rawEvent) => {
        const payload = JSON.parse((rawEvent as MessageEvent<string>).data) as { serverInstanceId?: string };
        const store = useWorldStore.getState();
        const previousId = store.serverInstanceId;
        if (previousId && payload.serverInstanceId && previousId !== payload.serverInstanceId) {
          store.resetWorld();
        }

        snapshotController?.abort();
        snapshotController = new AbortController();

        try {
          const snapshot = await fetchSnapshot(snapshotController.signal, getToken);
          useWorldStore.getState().setFullState(snapshot);
          useWorldStore.getState().setConnected(true, payload.serverInstanceId ?? snapshot.serverInstanceId ?? null, 0);
          reconnectAttempt = 0;
        } catch {
          scheduleReconnect();
        }
      });

      eventSource.addEventListener('state-update', (rawEvent) => {
        const payload = JSON.parse((rawEvent as MessageEvent<string>).data) as ServerDelta;
        useWorldStore.getState().applyDelta(payload);
      });

      eventSource.onerror = () => {
        scheduleReconnect();
      };
    };

    void connect();

    return () => {
      stopped = true;
      snapshotController?.abort();
      cleanupSource();
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
    };
  }, [getToken, url]);
}
