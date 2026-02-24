import { XClient, getBearerTokenFromEnv } from "./client";

type UsageEntry = {
  date?: string;
  usage?: number;
};

type UsageResponse = {
  data?: {
    daily_project_usage?: {
      project_id?: string;
      usage?: UsageEntry[];
    };
    project_usage?: number;
    project_cap?: number;
    cap_reset_day?: number;
    project_id?: string;
  };
};

export type XUsageToday = {
  todayUtc: string; // YYYY-MM-DD
  postsConsumedToday: number;
  projectCap?: number;
  capResetDay?: number;
  projectUsage?: number;
};

function getApiBaseUrl(): string {
  return process.env.X_API_BASE_URL ?? "https://api.x.com/2";
}

function getTodayUtcYmd(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function toNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

export async function getXUsageToday(args?: { days?: number }): Promise<XUsageToday> {
  const days = Math.max(1, Math.min(Math.floor(args?.days ?? 2), 30));
  const bearerToken = getBearerTokenFromEnv();

  const url = new URL(`${getApiBaseUrl()}/usage/tweets`);
  url.searchParams.set("days", String(days));
  url.searchParams.set(
    "usage.fields",
    ["daily_project_usage", "project_usage", "project_cap", "cap_reset_day"].join(","),
  );

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "user-agent": "ElDoradoSBOutreachAgent/1.0",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`X usage endpoint failed (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json()) as UsageResponse;
  const todayUtc = getTodayUtcYmd();

  const entries = json.data?.daily_project_usage?.usage ?? [];
  let postsConsumedToday = 0;
  for (const e of entries) {
    const d = String(e.date ?? "").slice(0, 10);
    if (d !== todayUtc) continue;
    postsConsumedToday = toNumber(e.usage) ?? 0;
    break;
  }

  return {
    todayUtc,
    postsConsumedToday,
    projectCap: toNumber(json.data?.project_cap) ?? undefined,
    capResetDay: toNumber(json.data?.cap_reset_day) ?? undefined,
    projectUsage: toNumber(json.data?.project_usage) ?? undefined,
  };
}

