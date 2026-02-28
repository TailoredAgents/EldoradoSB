import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@el-dorado/db";
import { requireAuth } from "@/lib/auth";

type ExportFormat = "openai" | "raw";

function clampInt(value: string | null, def: number, min: number, max: number): number {
  const n = Number(value ?? "");
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function hashThreadKey(threadKey: string): string {
  return crypto.createHash("sha256").update(threadKey).digest("hex").slice(0, 24);
}

function roleForDirection(direction: string): "user" | "assistant" {
  return direction === "outbound" ? "assistant" : "user";
}

export async function GET(req: NextRequest) {
  await requireAuth();

  const url = new URL(req.url);
  const platform = (url.searchParams.get("platform") ?? "x").trim() || "x";
  const days = clampInt(url.searchParams.get("days"), 90, 1, 365);
  const limit = clampInt(url.searchParams.get("limit"), 20000, 100, 100000);
  const format = ((url.searchParams.get("format") ?? "openai").trim() as ExportFormat) || "openai";

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.conversationMessage.findMany({
    where: { platform, createdAt: { gte: since } },
    orderBy: [{ threadKey: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: { threadKey: true, direction: true, text: true, createdAt: true },
  });

  // Sessionize by threadKey and gap.
  const maxGapMs = 6 * 60 * 60 * 1000;
  const lines: string[] = [];

  let currentThread: string | null = null;
  let currentEpisode: Array<{ role: "user" | "assistant"; content: string }> = [];
  let lastAt: Date | null = null;

  const flush = () => {
    if (currentEpisode.length < 2) return;
    const hasUser = currentEpisode.some((m) => m.role === "user");
    const hasAssistant = currentEpisode.some((m) => m.role === "assistant");
    if (!hasUser || !hasAssistant) return;

    if (format === "raw") {
      lines.push(
        JSON.stringify({
          messages: currentEpisode,
          metadata: { platform, thread: currentThread ? hashThreadKey(currentThread) : null },
        }),
      );
    } else {
      lines.push(JSON.stringify({ messages: currentEpisode }));
    }
  };

  for (const r of rows) {
    const shouldStartNewThread = currentThread !== r.threadKey;
    const shouldSplitGap = lastAt ? r.createdAt.getTime() - lastAt.getTime() > maxGapMs : false;

    if (shouldStartNewThread || shouldSplitGap) {
      flush();
      currentEpisode = [];
      lastAt = null;
    }

    currentThread = r.threadKey;
    currentEpisode.push({ role: roleForDirection(r.direction), content: r.text });
    lastAt = r.createdAt;
  }
  flush();

  const body = `${lines.join("\n")}\n`;
  const filename = `eldorado_${platform}_conversations_${days}d.jsonl`;

  return new Response(body, {
    headers: {
      "content-type": "application/jsonl; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

