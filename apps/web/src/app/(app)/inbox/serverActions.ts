"use server";

import { redirect } from "next/navigation";
import { prisma, XActionStatus, XActionType } from "@el-dorado/db";
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

