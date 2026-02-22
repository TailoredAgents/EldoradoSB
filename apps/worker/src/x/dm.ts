function getApiBaseUrl(): string {
  return process.env.X_API_BASE_URL ?? "https://api.x.com/2";
}

export type XDmEvent = {
  id: string;
  event_type?: string;
  created_at?: string;
  sender_id?: string;
  text?: string;
};

type XDmEventsResponse = {
  data?: XDmEvent[];
  meta?: { result_count?: number; next_token?: string };
};

type XDmSendResponse = {
  data?: { dm_event_id?: string };
};

async function getJson<T>(args: { accessToken: string; path: string; params?: Record<string, string | number | undefined> }): Promise<T> {
  const url = new URL(`${getApiBaseUrl()}/${args.path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(args.params ?? {})) {
    if (v === undefined) continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "user-agent": "ElDoradoSBOutreachAgent/1.0",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`X OAuth GET ${args.path} failed (${res.status}): ${text || res.statusText}`);
  }

  return (await res.json()) as T;
}

async function postJson<T>(args: { accessToken: string; path: string; body: unknown }): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}/${args.path.replace(/^\//, "")}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "content-type": "application/json",
      "user-agent": "ElDoradoSBOutreachAgent/1.0",
    },
    body: JSON.stringify(args.body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`X OAuth POST ${args.path} failed (${res.status}): ${text || res.statusText}`);
  }

  return (await res.json()) as T;
}

export async function listDmEvents(args: { accessToken: string; maxResults: number; paginationToken?: string }) {
  return getJson<XDmEventsResponse>({
    accessToken: args.accessToken,
    path: "dm_events",
    params: {
      max_results: Math.min(Math.max(args.maxResults, 5), 100),
      pagination_token: args.paginationToken,
      "dm_event.fields": ["event_type", "created_at", "sender_id", "text"].join(","),
    },
  });
}

export async function sendDm(args: { accessToken: string; participantId: string; text: string }) {
  return postJson<XDmSendResponse>({
    accessToken: args.accessToken,
    path: `dm_conversations/with/${args.participantId}/messages`,
    body: { text: args.text },
  });
}

