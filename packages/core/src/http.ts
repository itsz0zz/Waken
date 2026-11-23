export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** fetch with a timeout; resolves the Response or throws (network error / timeout). */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 4000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function json<T>(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  const res = await fetchWithTimeout(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } }, timeoutMs);
  if (!res.ok) {
    // The query string can hold a secret (Shelly auth_key) and this message is shown on screen.
    const fallback = `${init.method ?? 'GET'} ${url.split('?')[0]} : erreur ${res.status}`;
    throw new HttpError(res.status, problemDetail(await res.text()) ?? fallback);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** The "detail" of an application/problem+json body. */
function problemDetail(body: string): string | undefined {
  try {
    const problem: unknown = JSON.parse(body);
    if (problem && typeof problem === 'object' && 'detail' in problem && typeof problem.detail === 'string') return problem.detail;
  } catch {
    // Not JSON: the caller falls back to the status code.
  }
  return undefined;
}

export class CancelledError extends Error {
  constructor() {
    super('Annulé');
  }
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new CancelledError();
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const cancel = () => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal?.addEventListener('abort', cancel);
  });
}
