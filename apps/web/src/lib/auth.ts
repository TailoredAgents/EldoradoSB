import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const AUTH_COOKIE = "ed_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

type SessionPayload = {
  v: 1;
  iat: number;
  exp: number;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function getAuthSecret(): Buffer {
  const secret = process.env.SESSION_SECRET ?? requireEnv("APP_PASSWORD");
  return Buffer.from(secret, "utf8");
}

function sign(data: string): string {
  return crypto.createHmac("sha256", getAuthSecret()).update(data).digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function encodePayload(payload: SessionPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

function decodePayload(payloadB64: string): SessionPayload | null {
  try {
    const json = Buffer.from(payloadB64, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as SessionPayload;
    if (parsed?.v !== 1) return null;
    if (typeof parsed.iat !== "number" || typeof parsed.exp !== "number")
      return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createSessionCookieValue(nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload: SessionPayload = {
    v: 1,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_TTL_SECONDS,
  };
  const payloadB64 = encodePayload(payload);
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function getSessionPayload(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(AUTH_COOKIE)?.value;
  if (!raw) return null;

  const [payloadB64, sig] = raw.split(".");
  if (!payloadB64 || !sig) return null;
  const expected = sign(payloadB64);
  if (!timingSafeEqualHex(sig, expected)) return null;

  const payload = decodePayload(payloadB64);
  if (!payload) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return null;
  return payload;
}

export async function isLoggedIn(): Promise<boolean> {
  return (await getSessionPayload()) !== null;
}

export async function requireAuth(): Promise<void> {
  if (!(await isLoggedIn())) redirect("/login");
}

export async function setSessionCookie(): Promise<void> {
  const value = createSessionCookieValue();
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function verifyPasswordOrThrow(password: string): void {
  const expected = requireEnv("APP_PASSWORD");
  if (password !== expected) throw new Error("Invalid password");
}
