import { prisma } from "@el-dorado/db";
import { decryptToken, encryptToken, requireEnv } from "@el-dorado/shared";

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

export async function ensureAccessToken(): Promise<string> {
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

