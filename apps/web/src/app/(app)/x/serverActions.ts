"use server";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma, XActionStatus, XActionType } from "@el-dorado/db";
import { encryptToken } from "@el-dorado/shared";

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
      maxPostsPerDay: 3,
      maxAutoRepliesPerDay: 60,
      maxOutboundRepliesPerDay: 10,
      schedule: { posts: ["11:00", "16:00", "21:30"] },
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
