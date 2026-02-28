import { prisma, XActionStatus, XActionType, XHandledItemType } from "@el-dorado/db";
import { getAppTimeZone, startOfDayApp, startOfNextDayApp } from "../time";
import { XClient, getBearerTokenFromEnv } from "./client";
import type { XRecentSearchResponse, XTweet } from "./types";
import { ensureAccessToken } from "./credentials";
import { replyToTweet } from "./write";
import { markHandledItemDone, markHandledItemError, reserveHandledItem } from "./handled";

type Tier = "payout_reviews" | "picks_parlays" | "general";

export type OutboundResult =
  | { status: "skipped"; reason: string; postsRead?: number }
  | { status: "processed"; tiered: true; repliesSent: number; postsRead: number };

function pickFrom<T>(items: T[], seed: number): T {
  const idx = Math.abs(seed) % items.length;
  return items[idx]!;
}

function clampText(text: string, max = 275): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function getQueries(tier: Tier): string[] {
  if (tier === "payout_reviews") {
    return [
      '(payout OR "got paid" OR "got payed" OR paid OR cashout OR "cashed out" OR withdrew OR withdrawal OR withdraw) (sportsbook OR bookie OR "my book" OR "sports book") is:reply lang:en -is:retweet',
      '("still waiting" OR "not paid" OR scam OR scammed OR "no payout") (sportsbook OR bookie OR "my book") is:reply lang:en -is:retweet',
      '(payout OR cashout OR withdrawal OR withdraw) ("cash app" OR venmo OR zelle OR paypal OR "apple pay" OR crypto) is:reply lang:en -is:retweet',
      '("got paid" OR payout OR cashout) (telegram OR discord) is:reply lang:en -is:retweet',
    ];
  }

  if (tier === "picks_parlays") {
    return [
      '(parlay OR SGP OR props OR "player prop" OR odds OR line) ("what do you like" OR "who you got" OR "best bet") is:reply lang:en -is:retweet',
      '(POTD OR "pick of the day" OR "best bet" OR units) (parlay OR props OR straight) is:reply lang:en -is:retweet',
      '(VIP OR Discord OR Patreon) (picks OR betting) is:reply lang:en -is:retweet',
      '(parlay OR props) ("cash app" OR venmo OR zelle OR paypal OR "apple pay" OR crypto) is:reply lang:en -is:retweet',
    ];
  }

  return [
    '(sportsbook OR "betting app" OR "where can i bet" OR "sign up" OR signup OR bonus OR "free play" OR "deposit match") is:reply lang:en -is:retweet',
    '(sports betting OR sportsbetting OR betting) (bonus OR "free play" OR promo) is:reply lang:en -is:retweet',
    '("cash app" OR venmo OR zelle OR paypal OR "apple pay" OR crypto) (sportsbook OR betting) is:reply lang:en -is:retweet',
  ];
}

function isHighIntentDepositor(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("sportsbook") ||
    t.includes("betting app") ||
    t.includes("where can i bet") ||
    t.includes("bonus") ||
    t.includes("free play") ||
    t.includes("deposit match") ||
    t.includes("signup") ||
    t.includes("sign up")
  );
}

function buildReply(args: { tier: Tier; tweetText: string; disclaimer: string; daySeed: number }): string {
  const footer = args.disclaimer ? ` ${args.disclaimer}` : "";

  const linkCode =
    args.tier === "payout_reviews" ? "LINK PAYOUT" : args.tier === "picks_parlays" ? "LINK PICKS" : "LINK GEN";

  const linkCta = isHighIntentDepositor(args.tweetText)
    ? `If you want a 200% deposit match (Free Play bonus), DM us ${linkCode} and we'll send the signup link.`
    : `If you're looking for a 200% deposit match (Free Play bonus), DM us ${linkCode} for the signup link.`;

  if (args.tier === "payout_reviews") {
    const opener = pickFrom(
      ["Payouts matter.", "Totally get it—cashouts are everything.", "Real talk: payouts are the #1 thing."],
      args.daySeed,
    );
    return clampText(`${opener} ${linkCta}${footer}`, 275);
  }

  if (args.tier === "picks_parlays") {
    const helpful = pickFrom(
      [
        "Props/parlays tip: shop lines and keep unit sizing consistent.",
        "Quick reminder: track your bets and avoid chasing.",
        "Process > one night. Bankroll discipline wins long term.",
      ],
      args.daySeed,
    );
    return clampText(`${helpful} ${linkCta}${footer}`, 275);
  }

  const general = pickFrom(
    [
      "If you're betting weekly, bankroll discipline beats hot streaks.",
      "Quick reminder: track results and don't chase.",
      "Shop lines, stay consistent, and manage bankroll.",
    ],
    args.daySeed,
  );
  return clampText(`${general} ${linkCta}${footer}`, 275);
}

function linkCodeForTier(tier: Tier): "LINK PAYOUT" | "LINK PICKS" | "LINK GEN" {
  return tier === "payout_reviews" ? "LINK PAYOUT" : tier === "picks_parlays" ? "LINK PICKS" : "LINK GEN";
}

function buildReplyV2(args: {
  tier: Tier;
  tweetText: string;
  disclaimer: string;
  seed: number;
}): { replyText: string; variantKey: string; linkCode: string } {
  const footer = args.disclaimer ? ` ${args.disclaimer}` : "";
  const linkCode = linkCodeForTier(args.tier);

  const linkCta = isHighIntentDepositor(args.tweetText)
    ? `If you want a 200% deposit match (Free Play bonus), DM us ${linkCode} and we'll send the signup link.`
    : `If you're looking for a 200% deposit match (Free Play bonus), DM us ${linkCode} for the signup link.`;

  if (args.tier === "payout_reviews") {
    const variants: Array<{ key: string; make: () => string }> = [
      { key: "payout:v1", make: () => `Payouts matter. ${linkCta}${footer}` },
      { key: "payout:v2", make: () => `Cashouts are everything. ${linkCta}${footer}` },
      { key: "payout:v3", make: () => `Real talk: payouts are the #1 thing. ${linkCta}${footer}` },
      { key: "payout:v4", make: () => `If you're switching books because of payouts, we can help. ${linkCta}${footer}` },
    ];
    const v = pickFrom(variants, args.seed);
    return { replyText: clampText(v.make(), 275), variantKey: v.key, linkCode };
  }

  if (args.tier === "picks_parlays") {
    const variants: Array<{ key: string; make: () => string }> = [
      { key: "picks:v1", make: () => `Props/parlays tip: shop lines and keep unit sizing consistent. ${linkCta}${footer}` },
      { key: "picks:v2", make: () => `Quick reminder: track your bets and avoid chasing. ${linkCta}${footer}` },
      { key: "picks:v3", make: () => `Bankroll discipline wins long-term. ${linkCta}${footer}` },
      { key: "picks:v4", make: () => `If you're betting props/parlays weekly, we can help. ${linkCta}${footer}` },
    ];
    const v = pickFrom(variants, args.seed);
    return { replyText: clampText(v.make(), 275), variantKey: v.key, linkCode };
  }

  const variants: Array<{ key: string; make: () => string }> = [
    { key: "gen:v1", make: () => `If you're betting weekly, bankroll discipline beats hot streaks. ${linkCta}${footer}` },
    { key: "gen:v2", make: () => `Quick reminder: track results and don't chase. ${linkCta}${footer}` },
    { key: "gen:v3", make: () => `Shop lines, stay consistent, and manage bankroll. ${linkCta}${footer}` },
    { key: "gen:v4", make: () => `If you're looking for a book + bonus, we can help. ${linkCta}${footer}` },
  ];
  const v = pickFrom(variants, args.seed);
  return { replyText: clampText(v.make(), 275), variantKey: v.key, linkCode };
}

function normalizeMaxOutboundPerRun(value: number | null | undefined): number {
  const n = Number(value ?? 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(0, Math.min(Math.floor(n), 50));
}

function splitReadBudget(readBudget: number): Array<{ tier: Tier; budget: number }> {
  const total = Math.floor(readBudget);
  if (!Number.isFinite(total) || total < 10) return [];

  // X recent search typically expects max_results in [10..100]. We treat `readBudget` as the max posts we'd like
  // to consume for outbound in this run and split it across tiers without exceeding the total.
  if (total < 30) return [{ tier: "payout_reviews", budget: total }];

  if (total < 50) {
    const minEach = 10;
    const remaining = total - minEach * 2;
    const payout = minEach + Math.floor(remaining * 0.7);
    const picks = total - payout;
    return [
      { tier: "payout_reviews", budget: payout },
      { tier: "picks_parlays", budget: Math.max(minEach, picks) },
    ];
  }

  const minEach = 10;
  const remaining = total - minEach * 3;
  const payout = minEach + Math.floor(remaining * 0.6);
  const picks = minEach + Math.floor(remaining * 0.3);
  const general = total - payout - picks;
  return [
    { tier: "payout_reviews", budget: payout },
    { tier: "picks_parlays", budget: picks },
    { tier: "general", budget: Math.max(minEach, general) },
  ];
}

export async function runOutboundEngagement(args: { dryRun: boolean; readBudget: number }): Promise<OutboundResult> {
  const settings = await prisma.xAccountSettings.upsert({
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
      maxOutboundRepliesPerRun: 10,
      schedule: { posts: ["10:00", "12:30", "15:30", "18:30", "21:00", "23:30"] },
      disclaimerText: "21+ | Terms apply | Gamble responsibly",
    },
    select: {
      enabled: true,
      outboundEnabled: true,
      maxOutboundRepliesPerDay: true,
      maxOutboundRepliesPerRun: true,
      disclaimerText: true,
    },
  });

  if (!settings.enabled) return { status: "skipped", reason: "x_settings_disabled" };
  if (!settings.outboundEnabled) return { status: "skipped", reason: "outbound_disabled" };
  if (args.readBudget < 10) return { status: "skipped", reason: "no_read_budget" };
  if (!process.env.X_BEARER_TOKEN) return { status: "skipped", reason: "missing_x_bearer_token" };

  const now = new Date();
  const tz = getAppTimeZone();
  const dayStart = startOfDayApp(now, tz);
  const dayEnd = startOfNextDayApp(now, tz);

  const repliedToday = await prisma.xActionLog.count({
    where: {
      actionType: XActionType.outbound_comment,
      status: XActionStatus.success,
      createdAt: { gte: dayStart, lt: dayEnd },
    },
  });

  const remaining = Math.max(0, settings.maxOutboundRepliesPerDay - repliedToday);
  if (remaining <= 0) return { status: "skipped", reason: "max_outbound_reached" };

  const willDo = Math.min(normalizeMaxOutboundPerRun(settings.maxOutboundRepliesPerRun), remaining);
  if (willDo <= 0) return { status: "skipped", reason: "no_remaining_quota" };

  const daySeed = Number(dayStart.getTime() / 1000);

  const x = new XClient({
    bearerToken: getBearerTokenFromEnv(),
    minDelayMs: 1200,
    maxRetries: 3,
  });

  const tierBudgets = splitReadBudget(args.readBudget);

  const candidates: Array<{ tweet: XTweet; tier: Tier; query: string }> = [];
  let postsRead = 0;

  for (const { tier, budget } of tierBudgets) {
    if (budget < 10) continue;
    const query = pickFrom(getQueries(tier), daySeed + repliedToday * 13 + tier.length * 17);

    const res = await x.getJson<XRecentSearchResponse>("tweets/search/recent", {
      query,
      max_results: Math.min(100, Math.max(10, budget)),
      "tweet.fields": ["created_at", "public_metrics", "lang"].join(","),
    });

    const tweets = (res.data.data ?? []).filter((t) => (t.lang ?? "en") === "en");
    postsRead += tweets.length;
    for (const t of tweets) {
      if (!t.id || !t.text) continue;
      candidates.push({ tweet: t, tier, query });
    }

    if (candidates.length >= willDo * 6) break;
  }

  const uniqueById = new Map<string, { tweet: XTweet; tier: Tier; query: string }>();
  for (const c of candidates) {
    if (c.tweet.id && !uniqueById.has(c.tweet.id)) uniqueById.set(c.tweet.id, c);
  }
  const unique = Array.from(uniqueById.values()).slice(0, 100);

  if (unique.length === 0) {
    await prisma.xActionLog.create({
      data: {
        actionType: XActionType.outbound_comment,
        status: XActionStatus.skipped,
        reason: "no_candidate",
        meta: { postsRead, strategy: "tiered_depositors_v1" },
      },
    });
    return { status: "skipped", reason: "no_candidate", postsRead };
  }

  if (args.dryRun) {
    await prisma.xActionLog.create({
      data: {
        actionType: XActionType.outbound_comment,
        status: XActionStatus.skipped,
        reason: "dry_run",
        meta: {
          postsRead,
          willDo,
          strategy: "tiered_depositors_v1",
          candidates: unique.slice(0, Math.min(5, unique.length)).map((u) => ({ tier: u.tier, id: u.tweet.id })),
        },
      },
    });
    return { status: "skipped", reason: "dry_run", postsRead };
  }

  const disclaimer =
    (settings.disclaimerText && String(settings.disclaimerText).trim()) ||
    "21+ | Terms apply | Gamble responsibly";

  const accessToken = await ensureAccessToken();
  let repliesSent = 0;
  let attempts = 0;
  const maxAttempts = Math.min(unique.length, willDo * 4);

  for (const c of unique) {
    if (repliesSent >= willDo) break;
    if (attempts >= maxAttempts) break;
    const id = c.tweet.id;
    if (!id) continue;
    attempts += 1;

    const reserved = await reserveHandledItem({
      type: XHandledItemType.outbound_target_tweet,
      externalId: id,
      retryErroredAfterMs: 2 * 60 * 60 * 1000,
    });
    if (!reserved) continue;

    const built = buildReplyV2({
      tier: c.tier,
      tweetText: c.tweet.text,
      disclaimer,
      seed: daySeed + id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0),
    });
    const replyText = built.replyText;

    try {
      const posted = await replyToTweet({
        accessToken,
        text: replyText,
        inReplyToTweetId: id,
      });

      await prisma.xActionLog.create({
        data: {
          actionType: XActionType.outbound_comment,
          status: XActionStatus.success,
          reason: `outbound:${c.tier}`,
          xId: posted.id ?? null,
          meta: {
            tier: c.tier,
            query: c.query,
            postsRead,
            targetTweetId: id,
            replyText,
            replyVariant: built.variantKey,
            linkCode: built.linkCode,
            strategy: "tiered_depositors_v2",
          },
        },
      });

      await markHandledItemDone({ type: XHandledItemType.outbound_target_tweet, externalId: id });
      repliesSent += 1;
    } catch (err) {
      try {
        await prisma.xActionLog.create({
          data: {
            actionType: XActionType.outbound_comment,
            status: XActionStatus.error,
            reason: "outbound_post_error",
            meta: {
              tier: c.tier,
              query: c.query,
              postsRead,
              targetTweetId: id,
              replyText,
              message: err instanceof Error ? err.message : String(err),
            },
          },
        });
      } catch {
        // ignore
      }
      try {
        await markHandledItemError({ type: XHandledItemType.outbound_target_tweet, externalId: id, error: err });
      } catch {
        // ignore
      }
    }
  }

  if (repliesSent === 0) return { status: "skipped", reason: "no_sendable_candidate", postsRead };
  return { status: "processed", tiered: true, repliesSent, postsRead };
}
