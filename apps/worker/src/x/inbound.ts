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

type LinkCode = "payout" | "picks" | "gen";

function parseLinkCode(text: string): LinkCode | null {
  const t = normalize(text);
  const m = /\blink\s+(payout|picks|gen)\b/.exec(t);
  if (!m) return null;
  const code = m[1];
  if (code === "payout" || code === "picks" || code === "gen") return code;
  return null;
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
    `Thanks for reaching out.\n\nReply with:\n- LINK PAYOUT (signup link + bonus)\n- LINK PICKS (signup link + bonus)\n- LINK GEN (signup link + bonus)\n- AMBASSADOR (revshare partnership)\n- SUPPORT (help)\n\n${args.disclaimer}`,
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
  const name = "X - LINK replies";
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

async function createTrackingUrl(args: { baseUrl: string | null; destinationUrl: string; label: string; token?: string | null }) {
  const baseUrl = args.baseUrl ? args.baseUrl.replace(/\/+$/, "") : null;
  if (!baseUrl) return args.destinationUrl;

  const campaignId = await getOrCreateDefaultCampaignId();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = args.token ? String(args.token).trim() : randomToken(16);
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

async function ensureTierLinkUrl(args: {
  baseUrl: string | null;
  settingsId: number;
  destinationUrl: string;
  code: LinkCode | null;
  linkTokenDefault: string | null;
  linkTokenPayout: string | null;
  linkTokenPicks: string | null;
  linkTokenGen: string | null;
}): Promise<{ url: string; token: string | null; bucket: string }> {
  const baseUrl = args.baseUrl ? args.baseUrl.replace(/\/+$/, "") : null;
  if (!baseUrl) return { url: args.destinationUrl, token: null, bucket: "untracked" };

  const bucket =
    args.code === "payout"
      ? "payout_reviews"
      : args.code === "picks"
        ? "picks_parlays"
        : args.code === "gen"
          ? "general"
          : "default";

  const field =
    args.code === "payout"
      ? "linkTokenPayout"
      : args.code === "picks"
        ? "linkTokenPicks"
        : args.code === "gen"
          ? "linkTokenGen"
          : "linkTokenDefault";

  const existingToken =
    field === "linkTokenPayout"
      ? args.linkTokenPayout
      : field === "linkTokenPicks"
        ? args.linkTokenPicks
        : field === "linkTokenGen"
          ? args.linkTokenGen
          : args.linkTokenDefault;

  let token = existingToken ? String(existingToken).trim() : null;

  if (!token) {
    token = randomToken(16);
    await prisma.xAccountSettings.update({
      where: { id: args.settingsId },
      data: { [field]: token } as unknown as Prisma.XAccountSettingsUpdateInput,
      select: { id: true },
    });
  }

  // Ensure the tracking link exists for this token (idempotent).
  const existingLink = await prisma.trackingLink.findUnique({
    where: { token },
    select: { id: true },
  });
  if (!existingLink) {
    const campaignId = await getOrCreateDefaultCampaignId();
    try {
      await prisma.trackingLink.create({
        data: {
          campaignId,
          token,
          destinationUrl: args.destinationUrl,
          label: `x_link:${bucket}`,
          active: true,
        },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }

  return { url: `${baseUrl}/r/${token}`, token, bucket };
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
      linkTokenDefault: null,
      linkTokenPayout: null,
      linkTokenPicks: null,
      linkTokenGen: null,
      maxPostsPerDay: 3,
      maxAutoRepliesPerDay: 60,
      maxOutboundRepliesPerDay: 10,
      maxOutboundRepliesPerRun: 10,
      schedule: { posts: ["10:00", "12:30", "15:30", "18:30", "21:00", "23:30"] },
      disclaimerText: "21+ | Terms apply | Gamble responsibly",
    },
    select: {
      id: true,
      enabled: true,
      autoReplyEnabled: true,
      maxAutoRepliesPerDay: true,
      disclaimerText: true,
      publicBaseUrl: true,
      linkTokenDefault: true,
      linkTokenPayout: true,
      linkTokenPicks: true,
      linkTokenGen: true,
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

  let linkTokenDefault = settings.linkTokenDefault;
  let linkTokenPayout = settings.linkTokenPayout;
  let linkTokenPicks = settings.linkTokenPicks;
  let linkTokenGen = settings.linkTokenGen;

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
      const intent = isLinkIntent(text) ? "link" : "ambassador";
      const linkUrl = "https://eldoradosb.com/";

      const replyTextLegacy = isLinkIntent(text)
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

      const replyText =
        intent === "link"
          ? clampText(
              `DM us LINK and we'll send the signup link + 200% deposit match (Free Play bonus). ${disclaimer}`,
              275,
            )
          : clampText(`For ambassador partnership info, DM us AMBASSADOR. ${disclaimer}`, 275);
      void replyTextLegacy;

      if (args.dryRun) {
        await prisma.xActionLog.create({
          data: {
            actionType: XActionType.reply,
            status: XActionStatus.skipped,
            reason: "auto_reply:dry_run",
            meta: { sourceTweetId: t.id, replyText, intent },
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
            meta: { sourceTweetId: t.id, replyText, intent },
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
              meta: {
                sourceTweetId: t.id,
                replyText,
                intent,
                message: err instanceof Error ? err.message : String(err),
              },
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

      const destinationUrl = "https://eldoradosb.com/";
      const intent = isLinkIntent(event.text)
        ? "link"
        : isAmbassadorIntent(event.text)
          ? "ambassador"
          : "menu";

      const linkCode = intent === "link" ? parseLinkCode(event.text) : null;
      const link =
        intent === "link"
          ? await ensureTierLinkUrl({
              baseUrl: settings.publicBaseUrl ?? null,
              settingsId: settings.id,
              destinationUrl,
              code: linkCode,
              linkTokenDefault,
              linkTokenPayout,
              linkTokenPicks,
              linkTokenGen,
            })
          : { url: destinationUrl, token: null, bucket: "none" };

      if (intent === "link" && link.token) {
        if (linkCode === "payout") linkTokenPayout = link.token;
        else if (linkCode === "picks") linkTokenPicks = link.token;
        else if (linkCode === "gen") linkTokenGen = link.token;
        else linkTokenDefault = link.token;
      }

      const linkUrl = intent === "link" ? link.url : null;

      const msg =
        intent === "link"
          ? makeLinkMessage({ url: link.url, disclaimer })
          : intent === "ambassador"
            ? makeAmbassadorQuestions({ disclaimer })
            : makeMenuMessage({ disclaimer });

      if (args.dryRun) {
        await prisma.xActionLog.create({
          data: {
            actionType: XActionType.dm,
            status: XActionStatus.skipped,
            reason: "auto_reply:dry_run",
            meta: {
              sourceDmEventId: event.id,
              targetUserId: event.sender_id,
              intent,
              linkCode,
              linkBucket: link.bucket,
              linkUrl,
              msg,
            },
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
            meta: {
              sourceDmEventId: event.id,
              targetUserId: event.sender_id,
              intent,
              linkCode,
              linkBucket: link.bucket,
              linkUrl,
              msg,
            },
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
                intent,
                linkCode,
                linkBucket: link.bucket,
                linkUrl,
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
