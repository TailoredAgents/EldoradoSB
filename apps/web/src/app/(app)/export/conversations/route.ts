import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@el-dorado/db";
import { requireAuth } from "@/lib/auth";

type ExportFormat = "openai" | "raw";
type ExportPlatform = "x" | "reddit" | "all";

function clampInt(value: string | null, def: number, min: number, max: number): number {
  const n = Number(value ?? "");
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function clampFloat(value: string | null, def: number, min: number, max: number): number {
  const n = Number(value ?? "");
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function hashThreadKey(threadKey: string): string {
  return crypto.createHash("sha256").update(threadKey).digest("hex").slice(0, 24);
}

function roleForDirection(direction: string): "user" | "assistant" {
  return direction === "outbound" ? "assistant" : "user";
}

function isObj(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object";
}

function metaString(meta: unknown, key: string): string | null {
  if (!isObj(meta)) return null;
  const v = meta[key];
  return typeof v === "string" ? v : null;
}

function isManualOutbound(direction: string, meta: unknown): boolean {
  if (direction !== "outbound") return false;
  const reason = metaString(meta, "reason") ?? "";
  return reason.startsWith("manual:");
}

export async function GET(req: NextRequest) {
  await requireAuth();

  const url = new URL(req.url);
  const platform = ((url.searchParams.get("platform") ?? "x").trim() as ExportPlatform) || "x";
  const days = clampInt(url.searchParams.get("days"), 90, 1, 365);
  const limit = clampInt(url.searchParams.get("limit"), 20000, 100, 100000);
  const onlyManual = ["1", "true", "yes"].includes((url.searchParams.get("onlyManual") ?? "").trim().toLowerCase());
  const format = ((url.searchParams.get("format") ?? "openai").trim() as ExportFormat) || "openai";
  const maxGapHours = clampFloat(url.searchParams.get("maxGapHours"), 6, 1, 48);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const platforms: Array<Exclude<ExportPlatform, "all">> =
    platform === "all" ? ["reddit", "x"] : [platform === "reddit" ? "reddit" : "x"];

  const rows = await prisma.conversationMessage.findMany({
    where: { platform: { in: platforms }, createdAt: { gte: since } },
    orderBy: [{ platform: "asc" }, { threadKey: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: { platform: true, threadKey: true, direction: true, text: true, createdAt: true, userId: true, meta: true },
  });

  // Sessionize by threadKey and gap.
  const maxGapMs = Math.floor(maxGapHours * 60 * 60 * 1000);

  type Episode = {
    platform: string;
    threadKey: string;
    userId: string | null;
    startAt: Date;
    endAt: Date;
    hasManualOutbound: boolean;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };

  const episodes: Episode[] = [];

  let currentThread: string | null = null;
  let currentPlatform: string | null = null;
  let currentUserId: string | null = null;
  let currentHasManual = false;
  let currentStartAt: Date | null = null;
  let currentEndAt: Date | null = null;
  let currentEpisode: Array<{ role: "user" | "assistant"; content: string }> = [];
  let lastAt: Date | null = null;

  const flush = () => {
    if (currentEpisode.length < 2) return;
    const hasUser = currentEpisode.some((m) => m.role === "user");
    const hasAssistant = currentEpisode.some((m) => m.role === "assistant");
    if (!hasUser || !hasAssistant) return;
    if (onlyManual && !currentHasManual) return;
    if (!currentThread || !currentPlatform || !currentStartAt || !currentEndAt) return;

    episodes.push({
      platform: currentPlatform,
      threadKey: currentThread,
      userId: currentUserId,
      startAt: currentStartAt,
      endAt: currentEndAt,
      hasManualOutbound: currentHasManual,
      messages: currentEpisode,
    });
  };

  for (const r of rows) {
    const nextThread = `${r.platform}:${r.threadKey}`;
    const currentKey = currentPlatform && currentThread ? `${currentPlatform}:${currentThread}` : null;
    const shouldStartNewThread = currentKey !== nextThread;
    const shouldSplitGap = lastAt ? r.createdAt.getTime() - lastAt.getTime() > maxGapMs : false;

    if (shouldStartNewThread || shouldSplitGap) {
      flush();
      currentEpisode = [];
      lastAt = null;
      currentHasManual = false;
      currentUserId = null;
      currentStartAt = null;
      currentEndAt = null;
    }

    currentPlatform = r.platform;
    currentThread = r.threadKey;
    if (!currentUserId && r.userId) currentUserId = r.userId;
    if (!currentStartAt) currentStartAt = r.createdAt;
    currentEndAt = r.createdAt;
    if (isManualOutbound(r.direction, r.meta)) currentHasManual = true;

    currentEpisode.push({ role: roleForDirection(r.direction), content: r.text });
    lastAt = r.createdAt;
  }
  flush();

  let lines: string[] = [];

  if (format === "raw") {
    const threadKeysByPlatform = new Map<string, string[]>();
    const userIdsByPlatform = new Map<string, string[]>();

    for (const e of episodes) {
      threadKeysByPlatform.set(e.platform, [...(threadKeysByPlatform.get(e.platform) ?? []), e.threadKey]);
      if (e.userId) userIdsByPlatform.set(e.platform, [...(userIdsByPlatform.get(e.platform) ?? []), e.userId]);
    }

    for (const [p, keys] of threadKeysByPlatform) threadKeysByPlatform.set(p, Array.from(new Set(keys)));
    for (const [p, ids] of userIdsByPlatform) userIdsByPlatform.set(p, Array.from(new Set(ids)));

    const outcomes: Array<{
      platform: string;
      threadKey: string;
      createdAt: Date;
      tag: string;
      depositors: number | null;
      depositsUsd: number | null;
    }> = [];

    for (const [p, keys] of threadKeysByPlatform) {
      for (const batch of chunk(keys, 500)) {
        const rows0 = await prisma.conversationOutcome.findMany({
          where: { platform: p, threadKey: { in: batch }, createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: 100000,
          select: { platform: true, threadKey: true, createdAt: true, tag: true, depositors: true, depositsUsd: true },
        });
        outcomes.push(...rows0);
      }
    }

    const outcomeByKey = new Map<string, (typeof outcomes)[number]>();
    for (const o of outcomes) {
      const k = `${o.platform}::${o.threadKey}`;
      if (!outcomeByKey.has(k)) outcomeByKey.set(k, o);
    }

    const extUsers: Array<{ platform: string; userId: string; handle: string | null; name: string | null }> = [];
    for (const [p, ids] of userIdsByPlatform) {
      for (const batch of chunk(ids, 500)) {
        const rows0 = await prisma.externalUser.findMany({
          where: { platform: p, userId: { in: batch } },
          select: { platform: true, userId: true, handle: true, name: true },
        });
        extUsers.push(...rows0);
      }
    }

    const extByKey = new Map(extUsers.map((u) => [`${u.platform}::${u.userId}`, u]));

    lines = episodes.map((e) => {
      const k = `${e.platform}::${e.threadKey}`;
      const user = e.userId ? extByKey.get(`${e.platform}::${e.userId}`) ?? null : null;
      const userLabel =
        e.platform === "x"
          ? user?.handle
            ? `@${user.handle}`
            : e.userId
          : user?.handle
            ? `u/${user.handle}`
            : e.userId;

      const outcome = outcomeByKey.get(k) ?? null;
      const metadata = {
        platform: e.platform,
        thread: hashThreadKey(`${e.platform}:${e.threadKey}`),
        userId: e.userId,
        userLabel,
        startAt: e.startAt.toISOString(),
        endAt: e.endAt.toISOString(),
        hasManualOutbound: e.hasManualOutbound,
        messageCount: e.messages.length,
        outcome: outcome
          ? {
              at: outcome.createdAt.toISOString(),
              tag: outcome.tag,
              depositors: outcome.depositors ?? null,
              depositsUsd: outcome.depositsUsd ?? null,
            }
          : null,
      };

      return JSON.stringify({ messages: e.messages, metadata });
    });
  } else {
    lines = episodes.map((e) => JSON.stringify({ messages: e.messages }));
  }

  const body = `${lines.join("\n")}\n`;
  const filename = `eldorado_${platform}_conversations_${days}d${onlyManual ? "_manual" : ""}.jsonl`;

  return new Response(body, {
    headers: {
      "content-type": "application/jsonl; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
