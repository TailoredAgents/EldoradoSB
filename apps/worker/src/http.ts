export type RetryAfter = {
  shouldRetry: boolean;
  delayMs: number;
  reason: string;
};

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseRetryAfter(headers: Headers): RetryAfter | null {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return { shouldRetry: true, delayMs: Math.min(seconds * 1000, 60_000), reason: "retry-after" };
}

export function parseRateLimitReset(headers: Headers): number | null {
  const reset = headers.get("x-rate-limit-reset");
  if (!reset) return null;
  const seconds = Number(reset);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds * 1000;
}

