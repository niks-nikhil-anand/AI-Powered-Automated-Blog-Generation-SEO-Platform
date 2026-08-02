type FetchWithRetryOptions = RequestInit & {
  attempts?: number;
  timeoutMs?: number;
};

export async function fetchWithRetry(url: string, options: FetchWithRetryOptions = {}): Promise<Response> {
  const attempts = options.attempts ?? 2;
  const timeoutMs = options.timeoutMs ?? 15000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok || attempt === attempts) return res;
      lastError = new Error(`${res.status} ${res.statusText}`);
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt === attempts) break;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }

  throw lastError instanceof Error ? lastError : new Error("Fetch failed");
}
