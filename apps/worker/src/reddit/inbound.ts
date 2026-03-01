import { prisma, Prisma } from "@el-dorado/db";
import { redactMessageText } from "@el-dorado/shared";
import { RedditClient } from "./client";

type RedditListing<T> = {
  kind: string;
  data: {
    children: Array<{ kind: string; data: T }>;
  };
};

type RedditMessage = {
  id: string;
  name: string; // fullname, e.g. t4_xxx
  author?: string;
  subject?: string;
  body?: string;
  created_utc?: number;
  was_comment?: boolean;
  subreddit?: string;
  context?: string;
  new?: boolean;
};

type RedditApiResponse = {
  json?: {
    errors?: unknown[];
  };
};

function getEnv(name: string): string | null {
  const v = process.env[name];
  const t = String(v ?? "").trim();
  return t ? t : null;
}

function normalizeThreadKey(author: string | null): string {
  const a = String(author ?? "").trim();
  return `reddit_dm:${a || "unknown"}`;
}

export type RedditInboundResult =
  | { status: "skipped"; reason: string }
  | { status: "processed"; messagesFetched: number; messagesInserted: number; markedRead: number };

export async function runRedditInbound(args: { dryRun: boolean }): Promise<RedditInboundResult> {
  const settings =
    (await prisma.redditAccountSettings.findUnique({ where: { id: 1 } })) ??
    (await prisma.redditAccountSettings.create({
      data: {
        id: 1,
        enabled: false,
        outboundEnabled: false,
        inboundEnabled: false,
        maxCommentsPerDay: 8,
        maxCommentsPerRun: 2,
        ctaPercent: 15,
        config: { subreddits: [], xHandle: "EldoradoSB" } as Prisma.InputJsonValue,
      },
      select: { id: true },
    }).then(() => prisma.redditAccountSettings.findUnique({ where: { id: 1 } })));

  if (!settings?.enabled) return { status: "skipped", reason: "reddit_disabled" };
  if (!settings.inboundEnabled) return { status: "skipped", reason: "reddit_inbound_disabled" };

  const clientId = getEnv("REDDIT_CLIENT_ID");
  const clientSecret = getEnv("REDDIT_CLIENT_SECRET");
  const username = getEnv("REDDIT_USERNAME");
  const password = getEnv("REDDIT_PASSWORD");
  const userAgent = getEnv("REDDIT_USER_AGENT") || "ElDoradoSBOutreachAgent/1.0 by /u/eldorado";

  const missing = ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USERNAME", "REDDIT_PASSWORD"].filter((k) => !getEnv(k));
  if (missing.length > 0) return { status: "skipped", reason: `missing_env:${missing.join(",")}` };

  const reddit = new RedditClient({
    clientId: clientId!,
    clientSecret: clientSecret!,
    username: username!,
    password: password!,
    userAgent,
    minDelayMs: 1600,
    maxRetries: 3,
  });

  const listing = await reddit.getJson<RedditListing<RedditMessage>>("/message/unread", { limit: 50 });
  const messages = listing.data.data.children
    .map((c) => c.data)
    .filter((m) => Boolean(m?.name && m?.id && (m.body || m.subject)));

  if (messages.length === 0) return { status: "processed", messagesFetched: 0, messagesInserted: 0, markedRead: 0 };

  const rows = messages.map((m) => {
    const createdAt =
      typeof m.created_utc === "number" && Number.isFinite(m.created_utc) ? new Date(m.created_utc * 1000) : new Date();

    return {
      platform: "reddit",
      externalId: m.name,
      threadKey: normalizeThreadKey(m.author ?? null),
      direction: "inbound",
      userId: m.author ? String(m.author) : null,
      text: redactMessageText(m.body || m.subject || ""),
      createdAt,
      meta: {
        subject: m.subject ?? null,
        wasComment: Boolean(m.was_comment),
        subreddit: m.subreddit ?? null,
        context: m.context ?? null,
      } as Prisma.InputJsonValue,
    };
  });

  const authors = Array.from(new Set(messages.map((m) => String(m.author ?? "").trim()).filter(Boolean))).slice(0, 200);

  let inserted = 0;
  if (!args.dryRun) {
    if (authors.length > 0) {
      await prisma.$transaction(
        authors.map((a) =>
          prisma.externalUser.upsert({
            where: { platform_userId: { platform: "reddit", userId: a } },
            create: { platform: "reddit", userId: a, handle: a, name: null },
            update: { handle: a },
          }),
        ),
      );
    }
    const res = await prisma.conversationMessage.createMany({ data: rows, skipDuplicates: true });
    inserted = res.count ?? 0;
  }

  // Mark as read so we don't keep reprocessing; do this only when not dryRun.
  let markedRead = 0;
  if (!args.dryRun) {
    try {
      const form = new URLSearchParams();
      form.set("id", messages.map((m) => m.name).join(","));

      const res = await reddit.postForm<RedditApiResponse>("/api/read_message", form);
      const errors = res.data.json?.errors ?? [];
      if (Array.isArray(errors) && errors.length > 0) {
        throw new Error(`Reddit read_message error: ${JSON.stringify(errors).slice(0, 500)}`);
      }
      markedRead = messages.length;
    } catch {
      markedRead = 0;
    }
  }

  return { status: "processed", messagesFetched: messages.length, messagesInserted: inserted, markedRead };
}
