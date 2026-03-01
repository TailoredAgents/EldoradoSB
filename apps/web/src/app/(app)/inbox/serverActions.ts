"use server";

import { redirect } from "next/navigation";
import { ConversationOutcomeTag, Prisma, prisma, XActionStatus, XActionType } from "@el-dorado/db";
import { decryptToken, encryptToken, redactMessageText, requireEnv } from "@el-dorado/shared";
import { requireAuth } from "@/lib/auth";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

function getTokenUrl(): string {
  return process.env.X_OAUTH_TOKEN_URL ?? "https://api.twitter.com/2/oauth2/token";
}

function getClientId(): string {
  return requireEnv("X_OAUTH_CLIENT_ID");
}

function getClientSecret(): string | null {
  return process.env.X_OAUTH_CLIENT_SECRET?.trim() || null;
}

function getApiBaseUrl(): string {
  return process.env.X_API_BASE_URL ?? "https://api.x.com/2";
}

function getRedditUserAgent(): string {
  return process.env.REDDIT_USER_AGENT?.trim() || "ElDoradoSBOutreachAgent/1.0 by /u/eldorado";
}

let cachedRedditToken: { token: string; expiresAtMs: number | null } | null = null;

type RedditTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

async function ensureRedditAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedRedditToken?.token && cachedRedditToken.expiresAtMs && cachedRedditToken.expiresAtMs > now + 30_000) {
    return cachedRedditToken.token;
  }

  const clientId = requireEnv("REDDIT_CLIENT_ID");
  const clientSecret = requireEnv("REDDIT_CLIENT_SECRET");
  const username = requireEnv("REDDIT_USERNAME");
  const password = requireEnv("REDDIT_PASSWORD");

  const form = new URLSearchParams();
  form.set("grant_type", "password");
  form.set("username", username);
  form.set("password", password);

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": getRedditUserAgent(),
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Reddit token error (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json()) as RedditTokenResponse;
  const token = String(json.access_token ?? "").trim();
  if (!token) throw new Error("Missing reddit access_token");

  const expiresIn = Number(json.expires_in ?? 0);
  const expiresAtMs = Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;
  cachedRedditToken = { token, expiresAtMs };

  return token;
}

type RedditApiResponse = { json?: { errors?: unknown[] } };

async function sendRedditDm(args: { username: string; subject: string; text: string }) {
  const token = await ensureRedditAccessToken();
  const form = new URLSearchParams();
  form.set("to", args.username);
  form.set("subject", args.subject);
  form.set("text", args.text);
  form.set("api_type", "json");

  const res = await fetch("https://oauth.reddit.com/api/compose", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": getRedditUserAgent(),
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Reddit compose error (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json()) as RedditApiResponse;
  const errors = json.json?.errors ?? [];
  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(`Reddit compose error: ${JSON.stringify(errors).slice(0, 500)}`);
  }
}

async function ensureAccessToken(): Promise<string> {
  const cred = await prisma.xCredential.findUnique({ where: { id: 1 } });
  if (!cred) throw new Error("X account not connected (missing XCredential row)");

  const accessToken = decryptToken(cred.accessTokenEnc);
  const expiresAt = cred.expiresAt ? new Date(cred.expiresAt) : null;
  const shouldRefresh =
    Boolean(cred.refreshTokenEnc) &&
    expiresAt != null &&
    expiresAt.getTime() <= Date.now() + 60_000;

  if (!shouldRefresh) return accessToken;

  const refreshToken = decryptToken(cred.refreshTokenEnc!);

  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", refreshToken);
  form.set("client_id", getClientId());

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };

  const secret = getClientSecret();
  if (secret) {
    headers.authorization = `Basic ${Buffer.from(`${getClientId()}:${secret}`).toString("base64")}`;
  }

  const res = await fetch(getTokenUrl(), {
    method: "POST",
    headers,
    body: form.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token refresh failed (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json()) as TokenResponse;
  const newAccessToken = String(json.access_token ?? "").trim();
  if (!newAccessToken) throw new Error("Missing access_token in refresh response");

  const newRefreshToken = String(json.refresh_token ?? "").trim() || null;
  const expiresIn = Number(json.expires_in ?? 0);
  const newExpiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;

  await prisma.xCredential.update({
    where: { id: 1 },
    data: {
      accessTokenEnc: encryptToken(newAccessToken),
      refreshTokenEnc: newRefreshToken ? encryptToken(newRefreshToken) : cred.refreshTokenEnc,
      expiresAt: newExpiresAt,
      scope: json.scope ?? cred.scope,
      tokenType: json.token_type ?? cred.tokenType,
    },
  });

  return newAccessToken;
}

type XDmSendResponse = { data?: { dm_event_id?: string } };

async function sendDm(args: { accessToken: string; participantId: string; text: string }) {
  const res = await fetch(`${getApiBaseUrl()}/dm_conversations/with/${args.participantId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "content-type": "application/json",
      "user-agent": "ElDoradoSBOutreachAgent/1.0",
    },
    body: JSON.stringify({ text: args.text }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`X OAuth POST dm_conversations failed (${res.status}): ${text || res.statusText}`);
  }

  return (await res.json()) as XDmSendResponse;
}

function parseText(value: FormDataEntryValue | null): string {
  const t = String(value ?? "").trim();
  if (!t) throw new Error("missing text");
  if (t.length > 4000) throw new Error("text too long");
  return t;
}

function parseUserId(value: FormDataEntryValue | null): string {
  const t = String(value ?? "").trim();
  if (!t) throw new Error("missing userId");
  if (!/^\d{2,30}$/.test(t)) throw new Error("invalid userId");
  return t;
}

function parsePlatform(value: FormDataEntryValue | null): "x" | "reddit" {
  const t = String(value ?? "").trim();
  if (t === "reddit") return "reddit";
  return "x";
}

function parseThreadKey(value: FormDataEntryValue | null): string {
  const t = String(value ?? "").trim();
  if (!t) throw new Error("missing threadKey");
  if (t.length > 200) throw new Error("threadKey too long");
  return t;
}

function parseOutcomeTag(value: FormDataEntryValue | null): ConversationOutcomeTag {
  const t = String(value ?? "").trim();
  if (!t) throw new Error("missing tag");
  if (!Object.values(ConversationOutcomeTag).includes(t as ConversationOutcomeTag)) throw new Error("invalid tag");
  return t as ConversationOutcomeTag;
}

function parseOptionalInt(value: FormDataEntryValue | null, max: number): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error("invalid integer");
  const i = Math.floor(n);
  if (i < 0 || i > max) throw new Error("integer out of range");
  return i;
}

function parseOptionalFloat(value: FormDataEntryValue | null, max: number): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error("invalid number");
  if (n < 0 || n > max) throw new Error("number out of range");
  return n;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object";
}

function metaString(meta: unknown, key: string): string | null {
  if (!isObj(meta)) return null;
  const v = meta[key];
  return typeof v === "string" ? v : null;
}

export async function sendManualXDmAction(formData: FormData) {
  await requireAuth();

  const userId = parseUserId(formData.get("userId"));
  const threadKey = String(formData.get("threadKey") ?? `x_dm:${userId}`).trim() || `x_dm:${userId}`;
  const text = parseText(formData.get("text"));

  try {
    const accessToken = await ensureAccessToken();
    const sent = await sendDm({ accessToken, participantId: userId, text });
    const externalId =
      sent.data?.dm_event_id ?? `x_manual_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    await prisma.xActionLog.create({
      data: {
        actionType: XActionType.dm,
        status: XActionStatus.success,
        reason: "manual:dm_send",
        xId: sent.data?.dm_event_id ?? null,
        meta: { targetUserId: userId, threadKey, text: redactMessageText(text) },
      },
    });

    await prisma.conversationMessage.create({
      data: {
        platform: "x",
        externalId,
        threadKey,
        direction: "outbound",
        userId,
        text: redactMessageText(text),
        meta: { reason: "manual:dm_send" },
      },
    });
  } catch (err) {
    await prisma.xActionLog.create({
      data: {
        actionType: XActionType.dm,
        status: XActionStatus.error,
        reason: "manual:dm_send_error",
        meta: { targetUserId: userId, threadKey, message: err instanceof Error ? err.message : String(err) },
      },
    });
  }

  redirect(`/inbox?t=${encodeURIComponent(threadKey)}`);
}

function parseRedditUsername(value: FormDataEntryValue | null): string {
  const t = String(value ?? "").trim();
  if (!t) throw new Error("missing username");
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(t)) throw new Error("invalid username");
  return t;
}

function parseOptionalSubject(value: FormDataEntryValue | null): string {
  const t = String(value ?? "").trim();
  if (!t) return "Re:";
  return t.slice(0, 100);
}

export async function sendManualRedditDmAction(formData: FormData) {
  await requireAuth();

  const username = parseRedditUsername(formData.get("username"));
  const threadKey =
    String(formData.get("threadKey") ?? `reddit_dm:${username}`).trim() || `reddit_dm:${username}`;
  const subject = parseOptionalSubject(formData.get("subject"));
  const text = parseText(formData.get("text"));

  try {
    await sendRedditDm({ username, subject, text });

    await prisma.externalUser.upsert({
      where: { platform_userId: { platform: "reddit", userId: username } },
      create: { platform: "reddit", userId: username, handle: username, name: null },
      update: { handle: username },
    });

    await prisma.conversationMessage.create({
      data: {
        platform: "reddit",
        externalId: `reddit_manual_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        threadKey,
        direction: "outbound",
        userId: username,
        text: redactMessageText(text),
        meta: { reason: "manual:dm_send", subject } as Prisma.InputJsonValue,
      },
    });

    redirect(`/inbox?p=reddit&t=${encodeURIComponent(threadKey)}&ok=1`);
  } catch (err) {
    await prisma.conversationMessage.create({
      data: {
        platform: "reddit",
        externalId: `reddit_manual_error_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        threadKey,
        direction: "outbound",
        userId: username,
        text: redactMessageText(text),
        meta: {
          reason: "manual:dm_send_error",
          subject,
          error: err instanceof Error ? err.message : String(err),
        } as Prisma.InputJsonValue,
      },
    });

    redirect(`/inbox?p=reddit&t=${encodeURIComponent(threadKey)}`);
  }
}

export async function logConversationOutcomeAction(formData: FormData) {
  await requireAuth();

  const platform = parsePlatform(formData.get("platform"));
  const threadKey = parseThreadKey(formData.get("threadKey"));
  const userIdRaw = String(formData.get("userId") ?? "").trim() || null;
  const userId = userIdRaw ? userIdRaw : null;
  const tag = parseOutcomeTag(formData.get("tag"));
  const depositors = parseOptionalInt(formData.get("depositors"), 100000);
  const depositsUsd = parseOptionalFloat(formData.get("depositsUsd"), 1_000_000_000);
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 4000) || null;

  const recent = await prisma.conversationMessage.findMany({
    where: { platform, threadKey },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { meta: true, createdAt: true },
  });

  const picked =
    recent.find((r) => {
      const m = r.meta;
      return Boolean(
        metaString(m, "trackingLinkId") ||
          metaString(m, "trackingToken") ||
          metaString(m, "linkBucket") ||
          metaString(m, "linkSource") ||
          metaString(m, "msgTemplateKey") ||
          metaString(m, "followUpTemplateKey"),
      );
    }) ?? recent[0] ?? null;

  const meta = picked?.meta ?? null;
  const trackingLinkId = metaString(meta, "trackingLinkId");

  await prisma.conversationOutcome.create({
    data: {
      platform,
      threadKey,
      userId,
      tag,
      depositors,
      depositsUsd,
      notes,
      trackingLinkId: trackingLinkId || null,
      meta: meta == null ? undefined : (meta as Prisma.InputJsonValue),
    },
  });

  redirect(`/inbox?p=${encodeURIComponent(platform)}&t=${encodeURIComponent(threadKey)}&ok=1`);
}
