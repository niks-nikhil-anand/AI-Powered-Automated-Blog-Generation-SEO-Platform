import { researchConfig } from "../config";

type FetchWithRetryOptions = RequestInit & {
  attempts?: number;
  timeoutMs?: number;
};

/**
 * Defaults (timeout/attempts/User-Agent) come from researchConfig - i.e.
 * from RESEARCH_TIMEOUT_MS / RESEARCH_RETRY_COUNT / RESEARCH_USER_AGENT in
 * workers/shared/env.ts - rather than being hardcoded here with no way to
 * override. A caller's own `headers` still wins over the default User-Agent
 * if it sets one (e.g. github-trending.ts's Accept/Authorization headers).
 */
export async function fetchWithRetry(url: string, options: FetchWithRetryOptions = {}): Promise<Response> {
  const attempts = options.attempts ?? researchConfig.fetchRetryAttempts;
  const timeoutMs = options.timeoutMs ?? researchConfig.fetchTimeoutMs;
  const headers = { "User-Agent": researchConfig.userAgent, ...options.headers };
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...options, headers, signal: controller.signal });
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
