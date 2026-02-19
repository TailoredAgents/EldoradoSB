import { parseRateLimitReset, parseRetryAfter, sleep } from "../http";

type XClientOptions = {
  bearerToken: string;
  minDelayMs?: number;
  maxRetries?: number;
};

export type XResponse<T> = {
  data: T;
  requestId?: string;
  rateLimit?: {
    limit?: number;
    remaining?: number;
    resetEpochMs?: number;
  };
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function getBearerTokenFromEnv(): string {
  return process.env.X_BEARER_TOKEN ?? requireEnv("X_BEARER_TOKEN");
}

export class XClient {
  private readonly bearerToken: string;
  private readonly minDelayMs: number;
  private readonly maxRetries: number;
  private lastRequestAt = 0;

  constructor(options: XClientOptions) {
    this.bearerToken = options.bearerToken;
    this.minDelayMs = options.minDelayMs ?? 1200;
    this.maxRetries = options.maxRetries ?? 3;
  }

  private async pace() {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < this.minDelayMs) {
      await sleep(this.minDelayMs - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  async getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<XResponse<T>> {
    const url = new URL(`https://api.x.com/2/${path.replace(/^\//, "")}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }

    let attempt = 0;
    while (true) {
      attempt += 1;
      await this.pace();

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
          "User-Agent": "ElDoradoSBOutreachAgent/1.0",
        },
      });

      const requestId = res.headers.get("x-request-id") ?? undefined;
      const limit = Number(res.headers.get("x-rate-limit-limit") ?? "");
      const remaining = Number(res.headers.get("x-rate-limit-remaining") ?? "");
      const resetEpochMs = parseRateLimitReset(res.headers) ?? undefined;

      const rateLimit = {
        limit: Number.isFinite(limit) ? limit : undefined,
        remaining: Number.isFinite(remaining) ? remaining : undefined,
        resetEpochMs,
      };

      if (res.status === 429 || res.status >= 500) {
        if (attempt > this.maxRetries) {
          const text = await res.text().catch(() => "");
          throw new Error(`X API error (${res.status}) after retries: ${text || res.statusText}`);
        }

        const retryAfter = parseRetryAfter(res.headers);
        if (retryAfter) {
          await sleep(retryAfter.delayMs);
          continue;
        }

        // If we have a reset header, wait until reset + jitter.
        if (rateLimit.resetEpochMs && rateLimit.resetEpochMs > Date.now()) {
          const waitMs = Math.min(rateLimit.resetEpochMs - Date.now() + 750, 60_000);
          await sleep(waitMs);
          continue;
        }

        await sleep(1500 * attempt);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`X API error (${res.status}): ${text || res.statusText}`);
      }

      const json = (await res.json()) as T;
      return { data: json, requestId, rateLimit };
    }
  }
}

