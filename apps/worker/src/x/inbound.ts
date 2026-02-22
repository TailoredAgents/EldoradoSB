import crypto from "node:crypto";
import { prisma, Prisma, XActionStatus, XActionType, XHandledItemType } from "@el-dorado/db";
import { ensureAccessToken } from "./credentials";
import { getMe, getMentions } from "./oauthRead";
import { replyToTweet } from "./write";
import { listDmEvents, sendDm, type XDmEvent } from "./dm";
import { getAppTimeZone, startOfDayApp, startOfNextDayApp } from "../time";
import { markHandledItemDone, markHandledItemError, reserveHandledItem } from "./handled";

type InboundResult =
  | { status: "skipped"; reason: string }
  | {
      status: "processed";
      mentionsScanned: number;
      dmsScanned: number;
      repliesSent: number;
      dmsSent: number;
      postsRead: number;
    };

function pickFrom<T>(items: T[], seed: number): T {
  const idx = Math.abs(seed) % items.length;
  return items[idx]!;
}

function clampText(text: string, max = 275): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function isLinkIntent(text: string): boolean {
  const t = normalize(text);
  return (
    t.includes("link") ||
    t.includes("signup") ||
    t.includes("sign up") ||
    t.includes("bonus") ||
    t.includes("free play") ||
    t.includes("deposit match") ||
    t.includes("where do i") ||
    t.includes("how do i")
  );
}

function isAmbassadorIntent(text: string): boolean {
  const t = normalize(text);
  return t.includes("ambassador") || t.includes("revshare") || t.includes("rev share") || t.includes("partner");
}

function defaultDisclaimer(text: string | null | undefined): string {
  const t = String(text ?? "").trim();
  return t || "21+ | Terms apply | Gamble responsibly";
}

function makeLinkMessage(args: { url: string; disclaimer: string }): string {
  const methods = "Cash App, Venmo, Zelle, PayPal, Apple Pay, crypto";
  return clampText(
    `Here you go: ${args.url}\n\n200% deposit match (Free Play bonus). Deposit methods: ${methods}.\n\n${args.disclaimer}`,
    900,
  );
}

function makeMenuMessage(args: { disclaimer: string }): string {
  return clampText(
    `Thanks for reaching out.\n\nReply with:\n- LINK (signup link + bonus)\n- AMBASSADOR (revshare partnership)\n- SUPPORT (help)\n\n${args.disclaimer}`,
    900,
  );
}

function makeAmbassadorQuestions(args: { disclaimer: string }): string {
  return clampText(
    `Awesome. Quick questions:\n1) Your niche (NFL/NBA/props/parlays/etc.)\n2) Approx followers + weekly post volume\n3) Any VIP/Discord/Patreon today? (yes/no)\n4) Preferred payout method (Cash App/Venmo/Zelle/PayPal/Apple Pay/crypto)\n\nReply here with answers and we’ll follow up.\n\n${args.disclaimer}`,
    1200,
  );
}

async function getOrCreateDefaultCampaignId(): Promise<string> {
  const name = "Default - LINK replies";
  const existing = await prisma.campaign.findFirst({
    where: { name },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.campaign.create({
    data: { name, type: "depositors", active: true },
    select: { id: true },
  });
  return created.id;
}

function randomToken(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

async function createTrackingUrl(args: { baseUrl: string | null; destinationUrl: string; label: string }) {
  const baseUrl = args.baseUrl ? args.baseUrl.replace(/\/+$/, "") : null;
  if (!baseUrl) return args.destinationUrl;

  const campaignId = await getOrCreateDefaultCampaignId();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = randomToken(16);
    try {
      await prisma.trackingLink.create({
        data: {
          campaignId,
          token,
          destinationUrl: args.destinationUrl,
          label: args.label,
          active: true,
        },
      });
      return `${baseUrl}/r/${token}`;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  return args.destinationUrl;
}

async function countAutoRepliesToday(args: { dayStart: Date; dayEnd: Date }) {
  return prisma.xActionLog.count({
    where: {
      status: XActionStatus.success,
      createdAt: { gte: args.dayStart, lt: args.dayEnd },
      reason: { contains: "auto_reply" },
    },
  });
}

export async function runInboundAutoReply(args: { dryRun: boolean; readBudget: number }): Promise<InboundResult> {
  const settings = await prisma.xAccountSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      enabled: false,
      autoPostEnabled: false,
      autoReplyEnabled: false,
      outboundEnabled: false,
      publicBaseUrl: null,
      maxPostsPerDay: 3,
      maxAutoRepliesPerDay: 60,
      maxOutboundRepliesPerDay: 10,
      schedule: { posts: ["11:00", "16:00", "21:30"] },
      disclaimerText: "21+ | Terms apply | Gamble responsibly",
    },
    select: {
      enabled: true,
      autoReplyEnabled: true,
      maxAutoRepliesPerDay: true,
      disclaimerText: true,
      publicBaseUrl: true,
    },
  });

  if (!settings.enabled) return { status: "skipped", reason: "x_settings_disabled" };
  if (!settings.autoReplyEnabled) return { status: "skipped", reason: "auto_reply_disabled" };

  const now = new Date();
  const tz = getAppTimeZone();
  const dayStart = startOfDayApp(now, tz);
  const dayEnd = startOfNextDayApp(now, tz);

  const already = await countAutoRepliesToday({ dayStart, dayEnd });
  const remaining = Math.max(0, settings.maxAutoRepliesPerDay - already);
  if (remaining <= 0) {
    await prisma.xActionLog.create({
      data: {
        actionType: XActionType.inbound_scan,
        status: XActionStatus.skipped,
        reason: "max_auto_replies_reached",
        meta: { already, cap: settings.maxAutoRepliesPerDay },
      },
    });
    return { status: "skipped", reason: "max_auto_replies_reached" };
  }

  const accessToken = await ensureAccessToken();
  const me = await getMe({ accessToken });
  const meUser = me.data;
  if (!meUser?.id) return { status: "skipped", reason: "no_me_user" };

  const disclaimer = defaultDisclaimer(settings.disclaimerText);

  const accountState = await prisma.xAccountState.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
    select: { lastMentionId: true, lastDmEventId: true },
  });

  let repliesSent = 0;
  let dmsSent = 0;
  let postsRead = 0;
  let mentionsScanned = 0;
  let dmsScanned = 0;
  let mentionError = false;
  let dmError = false;
  let newestMentionIdSeen: string | null = null;
  let newestDmEventIdSeen: string | null = null;

  // Mentions: reply publicly for LINK/AMBASSADOR intents only.
  if (args.readBudget > 0) {
    const mentions = await getMentions({
      accessToken,
      userId: meUser.id,
      maxResults: Math.min(10, args.readBudget),
    });
    const tweets = mentions.data ?? [];
    mentionsScanned = tweets.length;
    postsRead += tweets.length;
    newestMentionIdSeen = mentions.meta?.newest_id ?? (tweets[0]?.id ?? null);

    for (const t of tweets) {
      if (repliesSent + dmsSent >= remaining) break;
      if (!t.id || !t.text) continue;
      const text = t.text;
      if (!isLinkIntent(text) && !isAmbassadorIntent(text)) continue;

      const daySeed = Number(dayStart.getTime() / 1000) + t.id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const baseUrl = settings.publicBaseUrl ?? null;
      const linkUrl = await createTrackingUrl({
        baseUrl,
        destinationUrl: "https://eldoradosb.com/",
        label: `mention:${t.id}`,
      });

      const replyText = isLinkIntent(text)
        ? makeLinkMessage({ url: linkUrl, disclaimer })
        : clampText(
            `${pickFrom(
              [
                "Thanks — if you’re interested in a revshare ambassador partnership, DM us AMBASSADOR and we’ll send details.",
                "Appreciate it. For ambassador partnership info, DM us AMBASSADOR.",
              ],
              daySeed,
            )} ${disclaimer}`,
            275,
          );

      if (args.dryRun) {
        await prisma.xActionLog.create({
          data: {
            actionType: XActionType.reply,
            status: XActionStatus.skipped,
            reason: "auto_reply:dry_run",
            meta: { sourceTweetId: t.id, replyText },
          },
        });
        continue;
      }

      const reserved = await reserveHandledItem({
        type: XHandledItemType.mention_tweet,
        externalId: t.id,
      });
      if (!reserved) continue;

      try {
        const posted = await replyToTweet({
          accessToken,
          text: replyText,
          inReplyToTweetId: t.id,
        });

        await prisma.xActionLog.create({
          data: {
            actionType: XActionType.reply,
            status: XActionStatus.success,
            reason: "auto_reply:mention",
            xId: posted.id ?? null,
            meta: { sourceTweetId: t.id, replyText, linkUrl },
          },
        });

        await markHandledItemDone({ type: XHandledItemType.mention_tweet, externalId: t.id });
        repliesSent += 1;
      } catch (err) {
        mentionError = true;
        try {
          await prisma.xActionLog.create({
            data: {
              actionType: XActionType.reply,
              status: XActionStatus.error,
              reason: "auto_reply:mention_error",
              meta: { sourceTweetId: t.id, replyText, message: err instanceof Error ? err.message : String(err) },
            },
          });
        } catch {
          // ignore
        }
        try {
          await markHandledItemError({ type: XHandledItemType.mention_tweet, externalId: t.id, error: err });
        } catch {
          // ignore
        }
      }
    }
  }

  // DMs: send menu / link / ambassador intake.
  // If DM endpoints are unavailable for your app/tier, errors will be logged by caller.
  if (repliesSent + dmsSent < remaining) {
    const dmRes = await listDmEvents({ accessToken, maxResults: 20 });
    const events = dmRes.data ?? [];
    dmsScanned = events.length;
    newestDmEventIdSeen = events[0]?.id ?? null;

    for (const e of events) {
      if (repliesSent + dmsSent >= remaining) break;
      const event = e as XDmEvent;
      if (!event.id || !event.sender_id || !event.text) continue;
      if (event.sender_id === meUser.id) continue;

      const linkUrl = await createTrackingUrl({
        baseUrl: settings.publicBaseUrl ?? null,
        destinationUrl: "https://eldoradosb.com/",
        label: `dm:${event.id}`,
      });

      const msg = isLinkIntent(event.text)
        ? makeLinkMessage({ url: linkUrl, disclaimer })
        : isAmbassadorIntent(event.text)
          ? makeAmbassadorQuestions({ disclaimer })
          : makeMenuMessage({ disclaimer });

      if (args.dryRun) {
        await prisma.xActionLog.create({
          data: {
            actionType: XActionType.dm,
            status: XActionStatus.skipped,
            reason: "auto_reply:dry_run",
            meta: { sourceDmEventId: event.id, targetUserId: event.sender_id, msg },
          },
        });
        continue;
      }

      const reserved = await reserveHandledItem({
        type: XHandledItemType.dm_event,
        externalId: event.id,
      });
      if (!reserved) continue;

      try {
        const sent = await sendDm({
          accessToken,
          participantId: event.sender_id,
          text: msg,
        });

        await prisma.xActionLog.create({
          data: {
            actionType: XActionType.dm,
            status: XActionStatus.success,
            reason: "auto_reply:dm",
            xId: sent.data?.dm_event_id ?? null,
            meta: { sourceDmEventId: event.id, targetUserId: event.sender_id, msg, linkUrl },
          },
        });

        await markHandledItemDone({ type: XHandledItemType.dm_event, externalId: event.id });
        dmsSent += 1;
      } catch (err) {
        dmError = true;
        try {
          await prisma.xActionLog.create({
            data: {
              actionType: XActionType.dm,
              status: XActionStatus.error,
              reason: "auto_reply:dm_error",
              meta: {
                sourceDmEventId: event.id,
                targetUserId: event.sender_id,
                msg,
                message: err instanceof Error ? err.message : String(err),
              },
            },
          });
        } catch {
          // ignore
        }
        try {
          await markHandledItemError({ type: XHandledItemType.dm_event, externalId: event.id, error: err });
        } catch {
          // ignore
        }
      }
    }
  }

  try {
    await prisma.xAccountState.update({
      where: { id: 1 },
      data: {
        lastMentionId: newestMentionIdSeen ?? accountState.lastMentionId,
        lastDmEventId: newestDmEventIdSeen ?? accountState.lastDmEventId,
      },
      select: { id: true },
    });
  } catch {
    // ignore: best-effort
  }

  await prisma.xActionLog.create({
    data: {
      actionType: XActionType.inbound_scan,
      status: XActionStatus.success,
      reason: args.dryRun ? "inbound_scan:dry_run" : "inbound_scan",
      meta: {
        mentionsScanned,
        dmsScanned,
        repliesSent,
        dmsSent,
        postsRead,
        mentionError,
        dmError,
        newestMentionIdSeen,
        newestDmEventIdSeen,
      },
    },
  });

  return { status: "processed", mentionsScanned, dmsScanned, repliesSent, dmsSent, postsRead };
}
