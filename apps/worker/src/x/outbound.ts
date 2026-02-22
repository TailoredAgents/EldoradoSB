import { prisma, XActionStatus, XActionType, XHandledItemType } from "@el-dorado/db";
import { getAppTimeZone, startOfDayApp, startOfNextDayApp } from "../time";
import { XClient, getBearerTokenFromEnv } from "./client";
import type { XRecentSearchResponse, XTweet } from "./types";
import { ensureAccessToken } from "./credentials";
import { replyToTweet } from "./write";
import { markHandledItemDone, markHandledItemError, reserveHandledItem } from "./handled";

type Track = "depositors" | "ambassadors";

type OutboundResult =
  | { status: "skipped"; reason: string }
  | { status: "replied"; track: Track; targetTweetId: string; replyTweetId?: string; postsRead: number };

function pickFrom<T>(items: T[], seed: number): T {
  const idx = Math.abs(seed) % items.length;
  return items[idx]!;
}

function clampText(text: string, max = 275): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function getQueries(track: Track): string[] {
  if (track === "depositors") {
    return [
      '(sportsbook OR "where can I bet" OR "betting app" OR "deposit match" OR "free play" OR bonus) lang:en -is:retweet',
      '(parlay OR SGP OR props OR "player prop") (odds OR line OR "what do you like") lang:en -is:retweet',
      '("cash app" OR venmo OR zelle OR paypal OR "apple pay" OR crypto) (sportsbook OR betting) lang:en -is:retweet',
    ];
  }
  return [
    '(POTD OR "pick of the day" OR "best bet" OR capper OR "units") lang:en -is:retweet',
    '(parlay OR props OR "closing line" OR CLV OR ROI) lang:en -is:retweet',
    '(Discord OR VIP OR Patreon) (picks OR betting) lang:en -is:retweet',
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

function buildReply(args: {
  track: Track;
  tweetText: string;
  disclaimer: string;
  daySeed: number;
}): string {
  const footer = args.disclaimer ? ` ${args.disclaimer}` : "";

  if (args.track === "ambassadors") {
    const templates = [
      "Love the content. If you’re open to a revshare ambassador partnership, DM us AMBASSADOR and we’ll send details.",
      "Solid work. We’re building an ambassador roster—DM us AMBASSADOR if you want the revshare details.",
      "Good insight. If you’re interested in an ambassador revshare partnership, DM us AMBASSADOR.",
    ];
    return clampText(`${pickFrom(templates, args.daySeed)}${footer}`, 275);
  }

  const helpful = pickFrom(
    [
      "Quick tip: keep it simple—track results, shop lines, and don’t chase.",
      "Process > one night. Manage bankroll, track units, and avoid tilt.",
      "If you’re betting weekly: consistency and discipline beat hot streaks.",
    ],
    args.daySeed,
  );

  const cta = isHighIntentDepositor(args.tweetText)
    ? "If you want a 200% deposit match (Free Play bonus), DM us LINK and we'll send the signup link."
    : "If you're looking for a 200% deposit match (Free Play bonus), DM us LINK for the signup link.";

  return clampText(`${helpful} ${cta}${footer}`, 275);
}

export async function runOutboundEngagement(args: {
  dryRun: boolean;
  readBudget: number;
}): Promise<OutboundResult> {
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
      schedule: { posts: ["11:00", "16:00", "21:30"] },
      disclaimerText: "21+ | Terms apply | Gamble responsibly",
    },
    select: {
      enabled: true,
      outboundEnabled: true,
      maxOutboundRepliesPerDay: true,
      disclaimerText: true,
    },
  });

  if (!settings.enabled) return { status: "skipped", reason: "x_settings_disabled" };
  if (!settings.outboundEnabled) return { status: "skipped", reason: "outbound_disabled" };
  if (args.readBudget <= 0) return { status: "skipped", reason: "no_read_budget" };
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

  // Keep it conservative: at most 1 outbound reply per worker run.
  const replyCountThisRun = 1;
  const willDo = Math.min(replyCountThisRun, remaining);
  if (willDo <= 0) return { status: "skipped", reason: "no_remaining_quota" };

  const daySeed = Number(dayStart.getTime() / 1000);
  const track: Track = daySeed % 2 === 0 ? "depositors" : "ambassadors";
  const queries = getQueries(track);
  const query = pickFrom(queries, daySeed + repliedToday * 13);

  const x = new XClient({
    bearerToken: getBearerTokenFromEnv(),
    minDelayMs: 1200,
    maxRetries: 3,
  });

  const maxResults = Math.max(1, Math.min(10, args.readBudget));
  const res = await x.getJson<XRecentSearchResponse>("tweets/search/recent", {
    query,
    max_results: maxResults,
    "tweet.fields": ["created_at", "public_metrics", "lang"].join(","),
  });

  const tweets = (res.data.data ?? []).filter((t) => (t.lang ?? "en") === "en");
  const postsRead = tweets.length;

  const disclaimer =
    (settings.disclaimerText && String(settings.disclaimerText).trim()) ||
    "21+ | Terms apply | Gamble responsibly";

  // Pick first viable tweet we haven't replied to today.
  const candidates = tweets
    .filter((t) => t.id && t.text)
    .slice(0, Math.min(10, tweets.length));

  let picked: XTweet | null = null;
  for (const t of candidates) {
    if (!t.id) continue;
    if (args.dryRun) {
      picked = t;
      break;
    }

    const reserved = await reserveHandledItem({
      type: XHandledItemType.outbound_target_tweet,
      externalId: t.id,
    });
    if (!reserved) continue;
    picked = t;
    break;
  }

  if (!picked || !picked.id) {
    await prisma.xActionLog.create({
      data: {
        actionType: XActionType.outbound_comment,
        status: XActionStatus.skipped,
        reason: "no_candidate",
        meta: { track, query, postsRead },
      },
    });
    return { status: "skipped", reason: "no_candidate" };
  }

  const replyText = buildReply({
    track,
    tweetText: picked.text,
    disclaimer,
    daySeed: daySeed + picked.id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0),
  });

  if (args.dryRun) {
    await prisma.xActionLog.create({
      data: {
        actionType: XActionType.outbound_comment,
        status: XActionStatus.skipped,
        reason: "dry_run",
        meta: { track, query, postsRead, targetTweetId: picked.id, replyText },
      },
    });
    return { status: "skipped", reason: "dry_run" };
  }

  const accessToken = await ensureAccessToken();
  try {
    const posted = await replyToTweet({
      accessToken,
      text: replyText,
      inReplyToTweetId: picked.id,
    });

    await prisma.xActionLog.create({
      data: {
        actionType: XActionType.outbound_comment,
        status: XActionStatus.success,
        reason: `outbound:${track}`,
        xId: posted.id ?? null,
        meta: { track, query, postsRead, targetTweetId: picked.id, replyText },
      },
    });

    await markHandledItemDone({ type: XHandledItemType.outbound_target_tweet, externalId: picked.id });

    return {
      status: "replied",
      track,
      targetTweetId: picked.id,
      replyTweetId: posted.id,
      postsRead,
    };
  } catch (err) {
    try {
      await prisma.xActionLog.create({
        data: {
          actionType: XActionType.outbound_comment,
          status: XActionStatus.error,
          reason: "outbound_post_error",
          meta: {
            track,
            query,
            postsRead,
            targetTweetId: picked.id,
            replyText,
            message: err instanceof Error ? err.message : String(err),
          },
        },
      });
    } catch {
      // ignore
    }
    try {
      await markHandledItemError({ type: XHandledItemType.outbound_target_tweet, externalId: picked.id, error: err });
    } catch {
      // ignore
    }
    return { status: "skipped", reason: "outbound_post_error" };
  }
}
