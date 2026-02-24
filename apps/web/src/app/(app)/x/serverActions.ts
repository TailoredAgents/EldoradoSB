"use server";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma, XActionStatus, XActionType } from "@el-dorado/db";
import { encryptToken } from "@el-dorado/shared";
import { Prisma } from "@el-dorado/db";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

type OAuthCookiePayload = {
  v: 1;
  state: string;
  verifier: string;
  iat: number;
};

const OAUTH_COOKIE = "x_oauth";
const OAUTH_COOKIE_TTL_SECONDS = 10 * 60;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function getAuthorizeUrl(): string {
  return process.env.X_OAUTH_AUTHORIZE_URL ?? "https://twitter.com/i/oauth2/authorize";
}

function getTokenUrl(): string {
  return process.env.X_OAUTH_TOKEN_URL ?? "https://api.twitter.com/2/oauth2/token";
}

function getClientId(): string {
  return requireEnv("X_OAUTH_CLIENT_ID");
}

function getClientSecret(): string | null {
  return process.env.X_OAUTH_CLIENT_SECRET?.trim() || null;
}

function getRedirectUri(): string {
  return requireEnv("X_OAUTH_REDIRECT_URI");
}

function getScopes(): string {
  return (
    process.env.X_OAUTH_SCOPES ??
    [
      "tweet.read",
      "tweet.write",
      "users.read",
      "offline.access",
      "dm.read",
      "dm.write",
    ].join(" ")
  );
}

function base64Url(buf: Buffer) {
  return buf.toString("base64url");
}

async function setOAuthCookie(payload: OAuthCookiePayload) {
  const json = JSON.stringify(payload);
  const value = base64Url(Buffer.from(json, "utf8"));
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OAUTH_COOKIE_TTL_SECONDS,
  });
}

export async function startXOAuthAction() {
  try {
    // Validate required env vars early.
    getClientId();
    getRedirectUri();
    // Ensures we fail loudly if secret for token encryption isn't set.
    // (encryptToken will throw if missing)
    encryptToken("test");

    const state = crypto.randomBytes(16).toString("base64url");
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = base64Url(
      crypto.createHash("sha256").update(verifier, "utf8").digest(),
    );

    await setOAuthCookie({ v: 1, state, verifier, iat: Date.now() });

    const url = new URL(getAuthorizeUrl());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", getClientId());
    url.searchParams.set("redirect_uri", getRedirectUri());
    url.searchParams.set("scope", getScopes());
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");

    await prisma.xActionLog.create({
      data: {
        actionType: XActionType.oauth_connect,
        status: XActionStatus.success,
        reason: "oauth_start",
        meta: { authorizeUrl: url.toString() },
      },
    });

    redirect(url.toString());
  } catch (err) {
    await prisma.xActionLog.create({
      data: {
        actionType: XActionType.oauth_connect,
        status: XActionStatus.error,
        reason: err instanceof Error ? err.message : String(err),
      },
    });
    redirect("/x?error=1");
  }
}

export async function disconnectXAction() {
  await prisma.xCredential.deleteMany({});
  redirect("/x?ok=disconnected");
}

function parseIntStrict(value: FormDataEntryValue | null): number {
  const str = String(value ?? "").trim();
  if (!str) throw new Error("missing");
  const num = Number(str);
  if (!Number.isFinite(num) || !Number.isInteger(num)) throw new Error("invalid");
  return num;
}

function parseOptionalInt(value: FormDataEntryValue | null): number | null {
  const str = String(value ?? "").trim();
  if (!str) return null;
  const num = Number(str);
  if (!Number.isFinite(num) || !Number.isInteger(num)) throw new Error("invalid");
  return num;
}

function parseOptionalToken(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? "").trim();
  if (!str) return null;
  // base64url-ish tokens (we generate these). Allow small manual tokens too.
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(str)) throw new Error("invalid token");
  return str;
}

function parseTimeHHMM(value: FormDataEntryValue | null, fallback: string): string {
  const str = String(value ?? "").trim();
  if (!str) return fallback;
  if (!/^\d{2}:\d{2}$/.test(str)) throw new Error("invalid time");
  const [hh, mm] = str.split(":").map((x) => Number(x));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) throw new Error("invalid time");
  if (hh < 0 || hh > 23) throw new Error("invalid time");
  if (mm < 0 || mm > 59) throw new Error("invalid time");
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export async function updateXAccountSettingsAction(formData: FormData) {
  try {
    const enabled = formData.get("enabled") === "on";
    const autoPostEnabled = formData.get("autoPostEnabled") === "on";
    const autoReplyEnabled = formData.get("autoReplyEnabled") === "on";
    const outboundEnabled = formData.get("outboundEnabled") === "on";

    const publicBaseUrlRaw = String(formData.get("publicBaseUrl") ?? "").trim() || null;
    const publicBaseUrl = publicBaseUrlRaw ? publicBaseUrlRaw.replace(/\/+$/, "") : null;

    const linkTokenDefault = parseOptionalToken(formData.get("linkTokenDefault"));
    const linkTokenPayout = parseOptionalToken(formData.get("linkTokenPayout"));
    const linkTokenPicks = parseOptionalToken(formData.get("linkTokenPicks"));
    const linkTokenGen = parseOptionalToken(formData.get("linkTokenGen"));

    const maxPostsPerDay = parseIntStrict(formData.get("maxPostsPerDay"));
    const maxAutoRepliesPerDay = parseIntStrict(formData.get("maxAutoRepliesPerDay"));
    const maxOutboundRepliesPerDay = parseIntStrict(formData.get("maxOutboundRepliesPerDay"));
    const maxOutboundRepliesPerRun = parseIntStrict(formData.get("maxOutboundRepliesPerRun"));
    const maxPostsConsumedPerUtcDay = parseOptionalInt(formData.get("maxPostsConsumedPerUtcDay"));

    if (
      maxPostsPerDay < 0 ||
      maxPostsPerDay > 20 ||
      maxAutoRepliesPerDay < 0 ||
      maxAutoRepliesPerDay > 500 ||
      maxOutboundRepliesPerDay < 0 ||
      maxOutboundRepliesPerDay > 200 ||
      maxOutboundRepliesPerRun < 0 ||
      maxOutboundRepliesPerRun > 50 ||
      (maxPostsConsumedPerUtcDay != null && (maxPostsConsumedPerUtcDay < 0 || maxPostsConsumedPerUtcDay > 500000))
    ) {
      throw new Error("invalid caps");
    }

    const post1 = parseTimeHHMM(formData.get("postTime1"), "10:00");
    const post2 = parseTimeHHMM(formData.get("postTime2"), "12:30");
    const post3 = parseTimeHHMM(formData.get("postTime3"), "15:30");
    const post4 = parseTimeHHMM(formData.get("postTime4"), "18:30");
    const post5 = parseTimeHHMM(formData.get("postTime5"), "21:00");
    const post6 = parseTimeHHMM(formData.get("postTime6"), "23:30");

    const disclaimerText = String(formData.get("disclaimerText") ?? "").trim() || null;

    await prisma.xAccountSettings.upsert({
      where: { id: 1 },
      update: {
        enabled,
        autoPostEnabled,
        autoReplyEnabled,
        outboundEnabled,
        publicBaseUrl,
        linkTokenDefault,
        linkTokenPayout,
        linkTokenPicks,
        linkTokenGen,
        maxPostsPerDay,
        maxAutoRepliesPerDay,
        maxOutboundRepliesPerDay,
        maxOutboundRepliesPerRun,
        maxPostsConsumedPerUtcDay,
        schedule: { posts: [post1, post2, post3, post4, post5, post6] } as Prisma.InputJsonValue,
        disclaimerText,
      },
      create: {
        id: 1,
        enabled,
        autoPostEnabled,
        autoReplyEnabled,
        outboundEnabled,
        publicBaseUrl,
        linkTokenDefault,
        linkTokenPayout,
        linkTokenPicks,
        linkTokenGen,
        maxPostsPerDay,
        maxAutoRepliesPerDay,
        maxOutboundRepliesPerDay,
        maxOutboundRepliesPerRun,
        maxPostsConsumedPerUtcDay,
        schedule: { posts: [post1, post2, post3, post4, post5, post6] } as Prisma.InputJsonValue,
        disclaimerText,
      },
    });

    redirect("/x?ok=1");
  } catch {
    redirect("/x?error=1");
  }
}

export async function exchangeXOAuthCodeAction(args: { code: string; state: string }) {
  const cookieStore = await cookies();
  const raw = cookieStore.get(OAUTH_COOKIE)?.value;
  cookieStore.set(OAUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  if (!raw) throw new Error("Missing OAuth cookie (start over)");
  const payloadJson = Buffer.from(raw, "base64url").toString("utf8");
  const payload = JSON.parse(payloadJson) as OAuthCookiePayload;
  if (!payload || payload.v !== 1) throw new Error("Invalid OAuth cookie");
  if (payload.state !== args.state) throw new Error("Invalid OAuth state");

  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", args.code);
  form.set("redirect_uri", getRedirectUri());
  form.set("client_id", getClientId());
  form.set("code_verifier", payload.verifier);

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
    throw new Error(`Token exchange failed (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json()) as TokenResponse;
  const accessToken = String(json.access_token ?? "").trim();
  if (!accessToken) throw new Error("Missing access_token in token response");

  const refreshToken = String(json.refresh_token ?? "").trim() || null;
  const expiresIn = Number(json.expires_in ?? 0);
  const expiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;

  const scope = String(json.scope ?? "").trim() || null;
  const tokenType = String(json.token_type ?? "").trim() || null;

  await prisma.xCredential.upsert({
    where: { id: 1 },
    update: {
      accessTokenEnc: encryptToken(accessToken),
      refreshTokenEnc: refreshToken ? encryptToken(refreshToken) : null,
      expiresAt,
      scope,
      tokenType,
    },
    create: {
      id: 1,
      accessTokenEnc: encryptToken(accessToken),
      refreshTokenEnc: refreshToken ? encryptToken(refreshToken) : null,
      expiresAt,
      scope,
      tokenType,
    },
  });

  await prisma.xAccountSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      enabled: false,
      autoPostEnabled: false,
      autoReplyEnabled: false,
      outboundEnabled: false,
      publicBaseUrl: null,
      maxPostsPerDay: 3,
      maxAutoRepliesPerDay: 60,
      maxOutboundRepliesPerDay: 10,
      maxOutboundRepliesPerRun: 10,
      schedule: { posts: ["10:00", "12:30", "15:30", "18:30", "21:00", "23:30"] },
    },
  });

  await prisma.xActionLog.create({
    data: {
      actionType: XActionType.oauth_connect,
      status: XActionStatus.success,
      reason: "oauth_exchanged",
      meta: { scope, tokenType, expiresAt: expiresAt?.toISOString() ?? null },
    },
  });
}
