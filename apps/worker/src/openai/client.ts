import OpenAI from "openai";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function hasOpenAiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getOpenAiClient() {
  return new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
}

export function getModelExtract(): string {
  return process.env.MODEL_EXTRACT ?? "gpt-5-mini";
}

export function getModelRank(): string {
  return process.env.MODEL_RANK ?? "gpt-5.2";
}

export function getModelWrite(): string {
  return process.env.MODEL_WRITE ?? getModelRank();
}
