import { parseRetryAfter, sleep } from "../http";

type RedditClientOptions = {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent: string;
  minDelayMs?: number;
  maxRetries?: number;
};

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

type RedditRateLimit = {
  remaining?: number;
  resetSeconds?: number;
  used?: number;
};

export class RedditClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly username: string;
  private readonly password: string;
  private readonly userAgent: string;
  private readonly minDelayMs: number;
  private readonly maxRetries: number;

  private lastRequestAt = 0;

  private accessToken: string | null = null;
  private tokenExpiresAtMs: number | null = null;

  constructor(options: RedditClientOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.username = options.username;
    this.password = options.password;
    this.userAgent = options.userAgent;
    this.minDelayMs = options.minDelayMs ?? 1500;
    this.maxRetries = options.maxRetries ?? 3;
  }

  private async pace() {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < this.minDelayMs) await sleep(this.minDelayMs - elapsed);
    this.lastRequestAt = Date.now();
  }

  private async ensureToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.tokenExpiresAtMs && this.tokenExpiresAtMs > now + 30_000) {
      return this.accessToken;
    }

    const form = new URLSearchParams();
    form.set("grant_type", "password");
    form.set("username", this.username);
    form.set("password", this.password);

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");

    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": this.userAgent,
      },
      body: form.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Reddit token error (${res.status}): ${text || res.statusText}`);
    }

    const json = (await res.json()) as TokenResponse;
    const token = String(json.access_token ?? "").trim();
    if (!token) throw new Error("Missing reddit access_token");

    const expiresIn = Number(json.expires_in ?? 0);
    const expiresAtMs = Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;

    this.accessToken = token;
    this.tokenExpiresAtMs = expiresAtMs;

    return token;
  }

  private parseRateLimit(headers: Headers): RedditRateLimit {
    const remaining = Number(headers.get("x-ratelimit-remaining") ?? "");
    const resetSeconds = Number(headers.get("x-ratelimit-reset") ?? "");
    const used = Number(headers.get("x-ratelimit-used") ?? "");
    return {
      remaining: Number.isFinite(remaining) ? remaining : undefined,
      resetSeconds: Number.isFinite(resetSeconds) ? resetSeconds : undefined,
      used: Number.isFinite(used) ? used : undefined,
    };
  }

  async getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<{ data: T; rateLimit: RedditRateLimit }> {
    const token = await this.ensureToken();
    const url = new URL(`https://oauth.reddit.com${path.startsWith("/") ? path : `/${path}`}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }

    let attempt = 0;
    while (true) {
      attempt += 1;
      await this.pace();

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "user-agent": this.userAgent,
        },
      });

      const rateLimit = this.parseRateLimit(res.headers);

      if (res.status === 429 || res.status >= 500) {
        if (attempt > this.maxRetries) {
          const text = await res.text().catch(() => "");
          throw new Error(`Reddit API error (${res.status}) after retries: ${text || res.statusText}`);
        }

        const retryAfter = parseRetryAfter(res.headers);
        if (retryAfter) {
          await sleep(retryAfter.delayMs);
          continue;
        }

        if (rateLimit.resetSeconds && rateLimit.resetSeconds > 0) {
          await sleep(Math.min(rateLimit.resetSeconds * 1000 + 750, 60_000));
          continue;
        }

        await sleep(1500 * attempt);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Reddit API error (${res.status}): ${text || res.statusText}`);
      }

      const json = (await res.json()) as T;
      return { data: json, rateLimit };
    }
  }

  async postForm<T>(path: string, form: URLSearchParams): Promise<{ data: T; rateLimit: RedditRateLimit }> {
    const token = await this.ensureToken();
    const url = new URL(`https://oauth.reddit.com${path.startsWith("/") ? path : `/${path}`}`);

    let attempt = 0;
    while (true) {
      attempt += 1;
      await this.pace();

      const res = await fetch(url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": this.userAgent,
        },
        body: form.toString(),
      });

      const rateLimit = this.parseRateLimit(res.headers);

      if (res.status === 429 || res.status >= 500) {
        if (attempt > this.maxRetries) {
          const text = await res.text().catch(() => "");
          throw new Error(`Reddit API error (${res.status}) after retries: ${text || res.statusText}`);
        }

        const retryAfter = parseRetryAfter(res.headers);
        if (retryAfter) {
          await sleep(retryAfter.delayMs);
          continue;
        }

        if (rateLimit.resetSeconds && rateLimit.resetSeconds > 0) {
          await sleep(Math.min(rateLimit.resetSeconds * 1000 + 750, 60_000));
          continue;
        }

        await sleep(1500 * attempt);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Reddit API error (${res.status}): ${text || res.statusText}`);
      }

      const json = (await res.json()) as T;
      return { data: json, rateLimit };
    }
  }
}

