let tokenGetter: (() => Promise<string | undefined>) | null = null;

export function setTokenGetter(fn: (() => Promise<string | undefined>) | null) {
  tokenGetter = fn;
}

export async function getAuthToken(): Promise<string> {
  const token = tokenGetter ? await tokenGetter() : undefined;
  if (!token) {
    throw new Error('Not authenticated');
  }
  return token;
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}
