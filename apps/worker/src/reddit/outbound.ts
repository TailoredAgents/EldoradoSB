import { prisma, Prisma } from "@el-dorado/db";
import { getAppTimeZone, startOfDayApp, startOfNextDayApp } from "../time";
import { redactMessageText } from "@el-dorado/shared";
import { RedditClient } from "./client";
import { markHandledItemDone, markHandledItemError, reserveHandledItem } from "./handled";

type Tier = "payout_reviews" | "picks_parlays" | "general";

type RedditListing<T> = {
  kind: string;
  data: {
    children: Array<{ kind: string; data: T }>;
  };
};

type RedditSubmission = {
  id: string;
  name: string; // fullname, e.g. t3_abc
  title?: string;
  selftext?: string;
  subreddit?: string;
  author?: string;
  created_utc?: number;
  over_18?: boolean;
  permalink?: string;
  locked?: boolean;
  archived?: boolean;
  stickied?: boolean;
};

type RedditComment = {
  id: string;
  name: string; // fullname, e.g. t1_abc
  body?: string;
  subreddit?: string;
  author?: string;
  created_utc?: number;
  over_18?: boolean;
  link_id?: string;
  parent_id?: string;
  locked?: boolean;
  archived?: boolean;
};

type RedditCommentResponse = {
  json?: {
    errors?: unknown[];
    data?: { things?: Array<{ kind: string; data: { id?: string; name?: string } }> };
  };
};

type SubredditConfig = { name: string; allowCta: boolean };

function getEnv(name: string): string | null {
  const v = process.env[name];
  const t = String(v ?? "").trim();
  return t ? t : null;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function seedFrom(parts: string[]): number {
  let acc = 0;
  for (const p of parts) {
    const s = String(p ?? "");
    for (let i = 0; i < s.length; i += 1) acc = (acc * 31 + s.charCodeAt(i)) >>> 0;
  }
  return acc;
}

function clampText(text: string, max = 9000): string {
  const t = String(text ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function pickVariant<T>(items: readonly T[], seed: number): T {
  const idx = Math.abs(seed) % items.length;
  return items[idx]!;
}

function classifyTier(text: string): Tier | null {
  const t = normalize(text);

  const payout =
    t.includes("payout") ||
    t.includes("cashout") ||
    t.includes("cashed out") ||
    t.includes("withdraw") ||
    t.includes("withdrawal") ||
    t.includes("got paid") ||
    t.includes("still waiting") ||
    t.includes("not paid") ||
    t.includes("scam") ||
    t.includes("scammed");

  if (payout) return "payout_reviews";

  const picks =
    t.includes("parlay") ||
    t.includes("sgp") ||
    t.includes("props") ||
    t.includes("prop") ||
    t.includes("units") ||
    t.includes("potd") ||
    t.includes("pick of the day") ||
    t.includes("vip") ||
    t.includes("discord") ||
    t.includes("patreon");

  if (picks) return "picks_parlays";

  const general =
    t.includes("sportsbook") ||
    t.includes("bookie") ||
    t.includes("betting") ||
    t.includes("sign up") ||
    t.includes("signup") ||
    t.includes("bonus") ||
    t.includes("free play") ||
    t.includes("deposit match");

  if (general) return "general";
  return null;
}

function buildValueComment(args: { tier: Tier; seed: number }): { text: string; key: string } {
  if (args.tier === "payout_reviews") {
    const variants = [
      {
        key: "rd:payout:value:v1",
        text: "If payouts are the concern, a good rule is: start small, confirm a clean cashout once, then scale. Also watch for payout proof in recent threads (not just screenshots).",
      },
      {
        key: "rd:payout:value:v2",
        text: "Payout reality check: verify recent cashout experiences, ask what methods they pay with, and avoid sending large deposits until you see a successful withdrawal.",
      },
      {
        key: "rd:payout:value:v3",
        text: "When people say a book pays, ask: how fast, what method, and was it consistent over multiple withdrawals. The first cashout is the real test.",
      },
    ] as const;
    return pickVariant(variants, args.seed);
  }

  if (args.tier === "picks_parlays") {
    const variants = [
      {
        key: "rd:picks:value:v1",
        text: "Props/parlays tip: track everything and keep unit sizing consistent. Most people lose by overexposing the same outcome across multiple legs.",
      },
      {
        key: "rd:picks:value:v2",
        text: "If you're playing parlays a lot, consider mixing in a few straights with the same edges. It smooths variance and keeps you from chasing.",
      },
      {
        key: "rd:picks:value:v3",
        text: "Bankroll discipline beats hot streaks. Pick a unit size and stick to it - especially on props/parlays where variance is brutal.",
      },
    ] as const;
    return pickVariant(variants, args.seed);
  }

  const variants = [
    {
      key: "rd:gen:value:v1",
      text: "If you're shopping for a book, focus on payout reliability + line quality. Bonuses are nice, but getting paid consistently matters more long term.",
    },
    {
      key: "rd:gen:value:v2",
      text: "Quick reminder: track results and avoid chasing. Even small improvements (line shopping, unit sizing) compound a lot over time.",
    },
    {
      key: "rd:gen:value:v3",
      text: "If you're betting weekly, keep it simple: consistent unit size, shop lines, and don't let parlays become the whole strategy.",
    },
  ] as const;
  return pickVariant(variants, args.seed);
}

function buildSoftCta(args: { tier: Tier; xHandle: string }): { text: string; key: string } {
  const code = args.tier === "payout_reviews" ? "LINK PAYOUT REDDIT" : args.tier === "picks_parlays" ? "LINK PICKS REDDIT" : "LINK GEN REDDIT";
  return {
    key: `rd:cta:${args.tier}:x_dm`,
    text: `If you want our signup link + 200% match, DM @${args.xHandle} on X with "${code}".`,
  };
}

function readConfig(config: unknown): { subreddits: SubredditConfig[]; xHandle: string } {
  const fallback = { subreddits: [] as SubredditConfig[], xHandle: "EldoradoSB" };
  if (!config || typeof config !== "object") return fallback;
  const raw = config as { subreddits?: unknown; xHandle?: unknown };

  const subs: SubredditConfig[] = Array.isArray(raw.subreddits)
    ? raw.subreddits
        .map((s) => (s && typeof s === "object" ? (s as any) : null))
        .map((s) => {
          const name = s?.name ? String(s.name).trim() : "";
          const allowCta = Boolean(s?.allowCta);
          if (!name) return null;
          return { name, allowCta };
        })
        .filter((x): x is SubredditConfig => Boolean(x))
    : [];

  const xHandle = raw.xHandle ? String(raw.xHandle).trim() : "EldoradoSB";
  return { subreddits: subs, xHandle: xHandle || "EldoradoSB" };
}

export type RedditOutboundResult =
  | { status: "skipped"; reason: string }
  | { status: "processed"; commentsSent: number; candidatesScanned: number };

export async function runRedditOutbound(args: { dryRun: boolean }): Promise<RedditOutboundResult> {
  const settings =
    (await prisma.redditAccountSettings.findUnique({ where: { id: 1 } })) ??
    (await prisma.redditAccountSettings.create({
      data: {
        id: 1,
        enabled: false,
        outboundEnabled: false,
        maxCommentsPerDay: 8,
        maxCommentsPerRun: 2,
        ctaPercent: 15,
        config: { subreddits: [], xHandle: "EldoradoSB" } as Prisma.InputJsonValue,
      },
    }));

  if (!settings.enabled) return { status: "skipped", reason: "reddit_disabled" };
  if (!settings.outboundEnabled) return { status: "skipped", reason: "reddit_outbound_disabled" };

  // Require reddit creds only when enabled.
  const clientId = getEnv("REDDIT_CLIENT_ID");
  const clientSecret = getEnv("REDDIT_CLIENT_SECRET");
  const username = getEnv("REDDIT_USERNAME");
  const password = getEnv("REDDIT_PASSWORD");
  const userAgent =
    getEnv("REDDIT_USER_AGENT") || "ElDoradoSBOutreachAgent/1.0 by /u/eldorado";

  const missing = ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USERNAME", "REDDIT_PASSWORD"].filter(
    (k) => !getEnv(k),
  );
  if (missing.length > 0) return { status: "skipped", reason: `missing_env:${missing.join(",")}` };

  const cfg = readConfig(settings.config);
  if (cfg.subreddits.length === 0) return { status: "skipped", reason: "reddit_no_subreddits" };

  const tz = getAppTimeZone();
  const now = new Date();
  const dayStart = startOfDayApp(now, tz);
  const dayEnd = startOfNextDayApp(now, tz);

  const sentToday = await prisma.conversationMessage.count({
    where: { platform: "reddit", direction: "outbound", createdAt: { gte: dayStart, lt: dayEnd } },
  });
  const remainingDay = Math.max(0, settings.maxCommentsPerDay - sentToday);
  if (remainingDay <= 0) return { status: "skipped", reason: "reddit_daily_cap" };

  const willDo = Math.min(settings.maxCommentsPerRun, remainingDay);
  if (willDo <= 0) return { status: "skipped", reason: "reddit_no_quota" };

  const reddit = new RedditClient({
    clientId: clientId!,
    clientSecret: clientSecret!,
    username: username!,
    password: password!,
    userAgent,
    minDelayMs: 1600,
    maxRetries: 3,
  });

  const maxAgeSeconds = 24 * 60 * 60;
  const nowSeconds = Math.floor(Date.now() / 1000);

  const candidates: Array<{
    thingId: string;
    subreddit: string;
    permalink: string | null;
    tier: Tier;
    textForScoring: string;
    allowCta: boolean;
    kind: "submission" | "comment";
  }> = [];

  for (const sub of cfg.subreddits.slice(0, 20)) {
    const subName = sub.name.replace(/^r\//, "");

    // Recent submissions.
    const subsRes = await reddit.getJson<RedditListing<RedditSubmission>>(`/r/${subName}/new`, { limit: 15 });
    for (const child of subsRes.data.data.children) {
      const d = child.data;
      if (!d?.name) continue;
      if (d.over_18) continue;
      if (d.locked || d.archived || d.stickied) continue;
      if (typeof d.created_utc === "number" && nowSeconds - d.created_utc > maxAgeSeconds) continue;

      const text = `${d.title ?? ""}\n\n${d.selftext ?? ""}`.trim();
      const tier = classifyTier(text);
      if (!tier) continue;

      candidates.push({
        thingId: d.name,
        subreddit: subName,
        permalink: d.permalink ?? null,
        tier,
        textForScoring: text,
        allowCta: sub.allowCta,
        kind: "submission",
      });
    }

    // Recent comments (higher-intent in practice).
    const commentsRes = await reddit.getJson<RedditListing<RedditComment>>(`/r/${subName}/comments`, { limit: 25 });
    for (const child of commentsRes.data.data.children) {
      const d = child.data;
      if (!d?.name || !d.body) continue;
      if (d.over_18) continue;
      if (d.locked || d.archived) continue;
      if (typeof d.created_utc === "number" && nowSeconds - d.created_utc > maxAgeSeconds) continue;

      const tier = classifyTier(d.body);
      if (!tier) continue;

      candidates.push({
        thingId: d.name,
        subreddit: subName,
        permalink: null,
        tier,
        textForScoring: d.body,
        allowCta: sub.allowCta,
        kind: "comment",
      });
    }
  }

  // De-dupe candidates by thingId and cap scan size.
  const uniqueByThing = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) if (!uniqueByThing.has(c.thingId)) uniqueByThing.set(c.thingId, c);
  const unique = Array.from(uniqueByThing.values()).slice(0, 200);

  let commentsSent = 0;

  for (const c of unique) {
    if (commentsSent >= willDo) break;

    const reserved = await reserveHandledItem({
      platform: "reddit",
      type: "target",
      externalId: c.thingId,
      retryErroredAfterMs: 12 * 60 * 60 * 1000,
    });
    if (!reserved) continue;

    const seed = seedFrom([c.thingId, c.subreddit, String(dayStart.toISOString())]);
    const shouldCta = c.allowCta && settings.ctaPercent > 0 && (seed % 100) < settings.ctaPercent;

    const value = buildValueComment({ tier: c.tier, seed });
    const cta = shouldCta ? buildSoftCta({ tier: c.tier, xHandle: cfg.xHandle }) : null;

    const commentText = clampText(`${value.text}${cta ? `\n\n${cta.text}` : ""}`, 9000);

    if (args.dryRun) {
      await prisma.conversationMessage.create({
        data: {
          platform: "reddit",
          externalId: `dry_${c.thingId}_${Date.now()}`,
          threadKey: `reddit:${c.subreddit}:${c.thingId}`,
          direction: "outbound",
          userId: null,
          text: redactMessageText(commentText),
          meta: {
            dryRun: true,
            subreddit: c.subreddit,
            thingId: c.thingId,
            tier: c.tier,
            kind: c.kind,
            allowCta: c.allowCta,
            usedCta: Boolean(cta),
            templateKey: value.key,
            ctaKey: cta?.key ?? null,
            permalink: c.permalink,
          } as Prisma.InputJsonValue,
        },
      });
      await markHandledItemDone({ platform: "reddit", type: "target", externalId: c.thingId });
      commentsSent += 1;
      continue;
    }

    try {
      const form = new URLSearchParams();
      form.set("thing_id", c.thingId);
      form.set("text", commentText);
      form.set("api_type", "json");

      const res = await reddit.postForm<RedditCommentResponse>("/api/comment", form);
      const errors = res.data.json?.errors ?? [];
      if (Array.isArray(errors) && errors.length > 0) {
        throw new Error(`Reddit comment error: ${JSON.stringify(errors).slice(0, 500)}`);
      }

      const newThingName =
        res.data.json?.data?.things?.find((t) => t?.data?.name)?.data?.name ?? null;
      const externalId = newThingName ? String(newThingName) : `reddit_comment_${Date.now()}_${Math.random().toString(16).slice(2)}`;

      await prisma.conversationMessage.create({
        data: {
          platform: "reddit",
          externalId,
          threadKey: `reddit:${c.subreddit}:${c.thingId}`,
          direction: "outbound",
          userId: null,
          text: redactMessageText(commentText),
          meta: {
            subreddit: c.subreddit,
            thingId: c.thingId,
            tier: c.tier,
            kind: c.kind,
            allowCta: c.allowCta,
            usedCta: Boolean(cta),
            templateKey: value.key,
            ctaKey: cta?.key ?? null,
            permalink: c.permalink,
          } as Prisma.InputJsonValue,
        },
      });

      await markHandledItemDone({ platform: "reddit", type: "target", externalId: c.thingId });
      commentsSent += 1;
    } catch (err) {
      await markHandledItemError({ platform: "reddit", type: "target", externalId: c.thingId, error: err });
    }
  }

  return { status: "processed", commentsSent, candidatesScanned: unique.length };
}
