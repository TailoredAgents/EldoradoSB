"use server";

import { prisma } from "@el-dorado/db";
import { Prisma } from "@el-dorado/db";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

function isObj(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object";
}

export async function saveTemplatesAction(formData: FormData) {
  const raw = String(formData.get("templates") ?? "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    redirect("/templates?error=json");
  }

  const templates = (parsed === null ? {} : parsed) as Prisma.InputJsonValue;

  await prisma.settings.upsert({
    where: { id: 1 },
    update: { templates },
    create: { id: 1, templates },
  });

  revalidatePath("/templates");
  redirect("/templates?ok=1");
}

type Playbook = { key: string; label: string; text: string; enabled: boolean };
type Playbooks = { x: Playbook[]; reddit: Playbook[] };

function normalizeKey(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function clampText(raw: unknown, max: number): string {
  const t = String(raw ?? "");
  if (t.length <= max) return t;
  return t.slice(0, max);
}

function parsePlaybooks(value: unknown): Playbooks {
  const out: Playbooks = { x: [], reddit: [] };
  if (!isObj(value)) return out;

  const parseList = (raw: unknown): Playbook[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((p) => (isObj(p) ? p : null))
      .filter((p): p is Record<string, unknown> => Boolean(p))
      .map((p) => {
        const key = normalizeKey(p.key);
        const label = clampText(p.label, 60).trim();
        const text = clampText(p.text, 4000);
        const enabled = p.enabled !== false;
        if (!key || !label || !text.trim()) return null;
        return { key, label, text, enabled };
      })
      .filter((p): p is Playbook => Boolean(p));
  };

  out.x = parseList(value.x);
  out.reddit = parseList(value.reddit);
  return out;
}

export async function savePlaybooksAction(formData: FormData) {
  const raw = String(formData.get("playbooksJson") ?? "").trim();
  if (!raw) redirect("/templates?error=playbooks");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    redirect("/templates?error=playbooks_json");
  }

  const playbooks = parsePlaybooks(parsed);

  const existing =
    (await prisma.settings.findUnique({ where: { id: 1 }, select: { templates: true } })) ??
    (await prisma.settings.create({ data: { id: 1 }, select: { templates: true } }));

  const templates0 = isObj(existing.templates) ? (existing.templates as Record<string, unknown>) : {};

  const templates = {
    ...templates0,
    playbooks,
  } as Prisma.InputJsonValue;

  await prisma.settings.upsert({
    where: { id: 1 },
    update: { templates },
    create: { id: 1, templates },
  });

  revalidatePath("/templates");
  redirect("/templates?ok=1");
}
