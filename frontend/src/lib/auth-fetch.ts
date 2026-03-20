let tokenGetter: (() => Promise<string | undefined>) | null = null;

// Resolves when tokenGetter is first set — lets child effects await readiness
let tokenGetterReady: Promise<void>;
let resolveTokenGetterReady: () => void;
tokenGetterReady = new Promise<void>((r) => { resolveTokenGetterReady = r; });

export function setTokenGetter(fn: (() => Promise<string | undefined>) | null) {
  tokenGetter = fn;
  if (fn) resolveTokenGetterReady();
}

export async function getAuthToken(): Promise<string> {
  // Wait for setTokenGetter to be called (handles React parent/child effect ordering)
  await tokenGetterReady;
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
