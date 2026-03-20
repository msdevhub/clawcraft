let tokenGetter: (() => Promise<string | undefined>) | null = null;

export function setTokenGetter(fn: (() => Promise<string | undefined>) | null) {
  tokenGetter = fn;
}

export async function getAuthToken(): Promise<string> {
  // Retry up to 3 times with delay — Logto SDK may still be initializing
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = tokenGetter ? await tokenGetter() : undefined;
    if (token) return token;
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error('Not authenticated');
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}
