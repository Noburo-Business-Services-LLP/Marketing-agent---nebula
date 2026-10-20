// Shares one running request between callers that ask for the same thing at the same moment
// (for example two components that both read the credit balance when a page opens).
// It holds nothing after the request ends, so every later call asks the server again and nothing shown can be stale.
const running = new Map<string, Promise<unknown>>();

export function shareInflight<T>(key: string, start: () => Promise<T>): Promise<T> {
  const existing = running.get(key);
  if (existing) return existing as Promise<T>;
  const p = start().finally(() => { if (running.get(key) === p) running.delete(key); });
  running.set(key, p);
  return p;
}

/** True when a request may share a running one: a plain read with no body, no abort signal and no custom headers. */
export function isShareableRead(options: { method?: string; body?: unknown; signal?: unknown; headers?: unknown }): boolean {
  const method = (options.method || 'GET').toUpperCase();
  return method === 'GET' && options.body == null && options.signal == null && !options.headers;
}
