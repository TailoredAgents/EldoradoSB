import crypto from "node:crypto";

function getKeyFromSecret(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret, "utf8").digest(); // 32 bytes
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function getTokenEncryptionSecret(): string {
  return process.env.X_CREDENTIALS_SECRET ?? requireEnv("X_CREDENTIALS_SECRET");
}

export function encryptToken(plaintext: string, secret = getTokenEncryptionSecret()): string {
  const key = getKeyFromSecret(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptToken(encoded: string, secret = getTokenEncryptionSecret()): string {
  const [v, ivB64, tagB64, ctB64] = String(encoded ?? "").split(".");
  if (v !== "v1" || !ivB64 || !tagB64 || !ctB64) throw new Error("Invalid token encoding");

  const key = getKeyFromSecret(secret);
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ciphertext = Buffer.from(ctB64, "base64url");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

