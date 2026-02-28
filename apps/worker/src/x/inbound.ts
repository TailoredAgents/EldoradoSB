import crypto from "node:crypto";
import { OutreachChannel, ProspectStatus, prisma, Prisma, XActionStatus, XActionType, XHandledItemType } from "@el-dorado/db";
import { redactMessageText } from "@el-dorado/shared";
import { ensureAccessToken } from "./credentials";
import { getMe, getMentions } from "./oauthRead";
import { replyToTweet } from "./write";
import { listDmEvents, sendDm, type XDmEvent } from "./dm";
import { getAppTimeZone, startOfDayApp, startOfNextDayApp } from "../time";
import { markHandledItemDone, markHandledItemError, reserveHandledItem } from "./handled";
import { XClient, getBearerTokenFromEnv } from "./client";
import type { XUser } from "./types";

type InboundResult =
  | { status: "skipped"; reason: string }
  | {
      status: "processed";
      mentionsScanned: number;
      dmsScanned: number;
      repliesSent: number;
      dmsSent: number;
      followUpsSent: number;
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

function xDmThreadKey(otherUserId: string): string {
  return `x_dm:${otherUserId}`;
}

function parseCreatedAt(iso: string | null | undefined): Date | null {
  const s = String(iso ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object";
}

function metaString(meta: unknown, key: string): string | null {
  if (!isObj(meta)) return null;
  const v = meta[key];
  return typeof v === "string" ? v : null;
}

function metaBoolean(meta: unknown, key: string): boolean | null {
  if (!isObj(meta)) return null;
  const v = meta[key];
  return typeof v === "boolean" ? v : null;
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

function isHelpIntent(text: string): boolean {
  const t = normalize(text);
  return (
    t === "help" ||
    t === "support" ||
    t.includes("help ") ||
    t.includes("support") ||
    t.includes("trouble") ||
    t.includes("problem") ||
    t.includes("issue") ||
    t.includes("cant deposit") ||
    t.includes("can't deposit") ||
    t.includes("cant sign") ||
    t.includes("can't sign") ||
    t.includes("deposit help") ||
    t.includes("signup help") ||
    t.includes("sign up help")
  );
}

type LinkCode = "payout" | "picks" | "gen";

function parseLinkCode(text: string): LinkCode | null {
  const t = normalize(text);
  const m = /\blink\s+(payout|picks|gen)(?:\b|_)/.exec(t);
  if (!m) return null;
  const code = m[1];
  if (code === "payout" || code === "picks" || code === "gen") return code;
  return null;
}

type SourceTag = "reddit";

function parseSourceTag(text: string): SourceTag | null {
  const t = normalize(text);
  if (t.includes("reddit")) return "reddit";
  return null;
}

function defaultDisclaimer(text: string | null | undefined): string {
  const t = String(text ?? "").trim();
  return t || "21+ | Terms apply | Gamble responsibly";
}

type BuiltMessage = { text: string; templateKey: string };

function seedFrom(parts: string[]): number {
  let acc = 0;
  for (const p of parts) {
    const s = String(p ?? "");
    for (let i = 0; i < s.length; i += 1) acc = (acc * 31 + s.charCodeAt(i)) >>> 0;
  }
  return acc;
}

function pickVariant<T>(variants: readonly T[], seed: number): T {
  const idx = Math.abs(seed) % variants.length;
  return variants[idx]!;
}

function buildLinkMessageV2(args: {
  url: string;
  disclaimer: string;
  linkCode: string | null;
  linkBucket: string;
  seed: number;
}): BuiltMessage {
  const methods = "Cash App, Venmo, Zelle, PayPal, Apple Pay, crypto";
  const codeLine = args.linkCode ? `You asked for ${args.linkCode.toUpperCase()}. ` : "";
  const variants = [
    {
      key: `link:${args.linkBucket}:v1`,
      text: `${codeLine}Here you go - signup link: ${args.url}\n\nPromo: 200% deposit match (Free Play bonus).\nDeposit methods: ${methods}.\n\nReply HELP if you get stuck.\n\n${args.disclaimer}`,
    },
    {
      key: `link:${args.linkBucket}:v2`,
      text: `Got you. ${codeLine}Use this link to sign up: ${args.url}\n\nYou will see the 200% match (Free Play bonus) on deposit.\nMethods: ${methods}.\n\nReply HELP if you want a hand.\n\n${args.disclaimer}`,
    },
    {
      key: `link:${args.linkBucket}:v3`,
      text: `${codeLine}Link: ${args.url}\n\n200% deposit match (Free Play bonus).\nMethods: ${methods}.\n\nIf anything looks off, reply HELP.\n\n${args.disclaimer}`,
    },
  ] as const;

  const v = pickVariant(variants, args.seed);
  return { templateKey: v.key, text: clampText(v.text, 900) };
}

function buildHelpMessageV2(args: { url: string; disclaimer: string; seed: number }): BuiltMessage {
  const methods = "Cash App, Venmo, Zelle, PayPal, Apple Pay, crypto";
  const variants = [
    {
      key: "help:v1",
      text: `Happy to help.\n\n1) Sign up here: ${args.url}\n2) Choose a deposit method (${methods})\n3) Complete your deposit and claim the 200% match (Free Play bonus)\n\nIf you get stuck, reply with:\n- the deposit method you chose\n- what step you're on\n\n${args.disclaimer}`,
    },
    {
      key: "help:v2",
      text: `No worries - here is the link again: ${args.url}\n\nDeposit methods: ${methods}.\n\nReply with what method you are using + what step you are on and I will help you finish it.\n\n${args.disclaimer}`,
    },
  ] as const;
  const v = pickVariant(variants, args.seed);
  return { templateKey: v.key, text: clampText(v.text, 1200) };
}

function buildFollowUpMessageV2(args: { url: string; disclaimer: string; seed: number }): BuiltMessage {
  const methods = "Cash App, Venmo, Zelle, PayPal, Apple Pay, crypto";
  const variants = [
    {
      key: "followup:v1",
      text: `Quick follow-up - here is the signup link again: ${args.url}\n\nIf you need help depositing (${methods}), reply HELP.\n\n${args.disclaimer}`,
    },
    {
      key: "followup:v2",
      text: `Just bumping this in case it got buried - signup link: ${args.url}\n\nNeed help with deposit (${methods})? Reply HELP.\n\n${args.disclaimer}`,
    },
    {
      key: "followup:v3",
      text: `FYI - here is that link again: ${args.url}\n\nIf you want help getting set up (Cash App/Venmo/Zelle/etc.), reply HELP.\n\n${args.disclaimer}`,
    },
  ] as const;
  const v = pickVariant(variants, args.seed);
  return { templateKey: v.key, text: clampText(v.text, 900) };
}

function makeLinkMessage(args: { url: string; disclaimer: string }): string {
  const methods = "Cash App, Venmo, Zelle, PayPal, Apple Pay, crypto";
  return clampText(
    `Here you go: ${args.url}\n\n200% deposit match (Free Play bonus). Deposit methods: ${methods}.\n\n${args.disclaimer}`,
    900,
  );
}

function makeFollowUpMessage(args: { url: string; disclaimer: string }): string {
  const methods = "Cash App, Venmo, Zelle, PayPal, Apple Pay, crypto";
  return clampText(
    `Quick follow-up — here’s the signup link again: ${args.url}\n\nIf you need help depositing (${methods}), reply HELP.\n\n${args.disclaimer}`,
    900,
  );
}

function makeMenuMessage(args: { disclaimer: string }): string {
  return clampText(
    `Thanks for reaching out.\n\nReply with:\n- LINK PAYOUT (signup link + bonus)\n- LINK PICKS (signup link + bonus)\n- LINK GEN (signup link + bonus)\n- (Optional) add REDDIT if that’s where you found us\n- AMBASSADOR (revshare partnership)\n- SUPPORT (help)\n\n${args.disclaimer}`,
    900,
  );
}

function makeAmbassadorQuestions(args: { disclaimer: string }): string {
  return clampText(
    `Awesome. Quick questions:\n1) Your niche (NFL/NBA/props/parlays/etc.)\n2) Approx followers + weekly post volume\n3) Any VIP/Discord/Patreon today? (yes/no)\n4) Preferred payout method (Cash App/Venmo/Zelle/PayPal/Apple Pay/crypto)\n\nReply here with answers and we’ll follow up.\n\n${args.disclaimer}`,
    1200,
  );
}

function makeHelpMessage(args: { url: string; disclaimer: string }): string {
  const methods = "Cash App, Venmo, Zelle, PayPal, Apple Pay, crypto";
  return clampText(
    `Happy to help.\n\n1) Sign up here: ${args.url}\n2) Choose a deposit method (${methods})\n3) Complete your deposit on-site and claim the 200% match (Free Play bonus)\n\nIf you get stuck, reply with:\n- the deposit method you chose\n- what step you're on\n\n${args.disclaimer}`,
    1200,
  );
}

function makeAmbassadorThanksMessage(args: { disclaimer: string }): string {
  return clampText(
    `Got it — thanks for the details. We’ll review and follow up shortly.\n\nIf you also want the signup link + 200% match, DM LINK GEN.\n\n${args.disclaimer}`,
    900,
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

async function createTrackingUrl(args: {
  baseUrl: string | null;
  destinationUrl: string;
  label: string;
  token?: string | null;
}): Promise<{ tracked: boolean; url: string; token: string | null; trackingLinkId: string | null }> {
  const baseUrl = args.baseUrl ? args.baseUrl.replace(/\/+$/, "") : null;
  if (!baseUrl) return { tracked: false, url: args.destinationUrl, token: null, trackingLinkId: null };

  const campaignId = await getOrCreateDefaultCampaignId();
  let tokenOverride = args.token ? String(args.token).trim() : null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = tokenOverride || randomToken(16);
    try {
      const created = await prisma.trackingLink.create({
        data: {
          campaignId,
          token,
          destinationUrl: args.destinationUrl,
          label: args.label,
          active: true,
        },
        select: { id: true, token: true },
      });
      return {
        tracked: true,
        url: `${baseUrl}/r/${created.token}`,
        token: created.token,
        trackingLinkId: created.id,
      };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        tokenOverride = null;
        continue;
      }
      throw err;
    }
  }

  return { tracked: false, url: args.destinationUrl, token: null, trackingLinkId: null };
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

type XUsersLookupResponse = {
  data?: XUser[];
};

async function upsertProspectForAmbassadorLead(args: {
  xUserId: string;
  note: string;
}): Promise<string | null> {
  let user: XUser | null = null;

  if (process.env.X_BEARER_TOKEN) {
    try {
      const x = new XClient({ bearerToken: getBearerTokenFromEnv(), minDelayMs: 1200, maxRetries: 2 });
      const res = await x.getJson<XUsersLookupResponse>("users", {
        ids: args.xUserId,
        "user.fields": ["username", "name", "description", "location", "url", "verified", "public_metrics"].join(","),
      });
      user = res.data.data?.[0] ?? null;
    } catch {
      user = null;
    }
  }

  const handle = user?.username ? String(user.username) : `user_${args.xUserId}`;

  const prospect = await prisma.prospect.upsert({
    where: { xUserId: args.xUserId },
    create: {
      xUserId: args.xUserId,
      handle,
      name: user?.name ?? null,
      bio: user?.description ?? null,
      url: user?.url ?? null,
      location: user?.location ?? null,
      followers: user?.public_metrics?.followers_count ?? null,
      verified: user?.verified ?? null,
      status: ProspectStatus.new,
      tier: "ambassador",
      notes: args.note,
    },
    update: {
      handle,
      name: user?.name ?? null,
      bio: user?.description ?? null,
      url: user?.url ?? null,
      location: user?.location ?? null,
      followers: user?.public_metrics?.followers_count ?? null,
      verified: user?.verified ?? null,
      status: ProspectStatus.replied,
    },
    select: { id: true },
  });

  return prospect.id;
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

  let repliesSent = 0;
  let dmsSent = 0;
  let followUpsSent = 0;
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
    const menuSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recentMenuLogs = await prisma.xActionLog.findMany({
      where: {
        actionType: XActionType.dm,
        status: XActionStatus.success,
        reason: "auto_reply:dm_menu",
        createdAt: { gte: menuSince },
      },
      orderBy: { createdAt: "desc" },
      take: 2000,
      select: { meta: true, createdAt: true },
    });

    const menuSentUserIds = new Set<string>();
    for (const r of recentMenuLogs) {
      const targetUserId = metaString(r.meta, "targetUserId");
      if (!targetUserId) continue;
      menuSentUserIds.add(targetUserId);
    }

    const dmRes = await listDmEvents({ accessToken, maxResults: 20 });
    const events = dmRes.data ?? [];
    dmsScanned = events.length;
    newestDmEventIdSeen = events[0]?.id ?? null;

    // Store inbound messages (redacted) so Devon can reply manually and export later.
    try {
      const inboundToInsert = events
        .map((e) => e as XDmEvent)
        .filter((ev) => Boolean(ev.id && ev.sender_id && ev.text))
        .filter((ev) => ev.sender_id !== meUser.id)
        .map((ev) => ({
          platform: "x",
          externalId: ev.id,
          threadKey: xDmThreadKey(ev.sender_id!),
          direction: "inbound",
          userId: ev.sender_id,
          text: redactMessageText(ev.text!),
          createdAt: parseCreatedAt(ev.created_at) ?? new Date(),
          meta: { eventType: ev.event_type ?? null } as Prisma.InputJsonValue,
        }));

      if (inboundToInsert.length > 0) {
        await prisma.conversationMessage.createMany({
          data: inboundToInsert,
          skipDuplicates: true,
        });
      }
    } catch {
      // ignore: logging is best-effort
    }

    for (const e of events) {
      if (repliesSent + dmsSent >= remaining) break;
      const event = e as XDmEvent;
      if (!event.id || !event.sender_id || !event.text) continue;
      if (event.sender_id === meUser.id) continue;

      const destinationUrl = "https://eldoradosb.com/";
      const intent = isHelpIntent(event.text)
        ? "help"
        : isLinkIntent(event.text)
          ? "link"
          : isAmbassadorIntent(event.text)
            ? "ambassador"
            : "manual";

      const shouldAutoReply = intent === "help" || intent === "link";
      const shouldSendMenu = !shouldAutoReply && !menuSentUserIds.has(event.sender_id);

      const linkCode = intent === "link" ? parseLinkCode(event.text) : null;
      const linkSource = intent === "link" || intent === "help" ? (parseSourceTag(event.text) ?? "unknown") : "none";
      const linkBucket =
        intent === "help"
          ? "help"
          : intent !== "link"
          ? "none"
          : linkCode === "payout"
            ? "payout_reviews"
            : linkCode === "picks"
              ? "picks_parlays"
              : linkCode === "gen"
                ? "general"
                : "default";

      let link:
        | { tracked: boolean; url: string; token: string | null; trackingLinkId: string | null }
        | { tracked: false; url: string; token: null; trackingLinkId: null } = { tracked: false, url: destinationUrl, token: null, trackingLinkId: null };

      if (intent === "help") {
        const helpSince = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        const recent = await prisma.xActionLog.findMany({
          where: {
            actionType: XActionType.dm,
            status: XActionStatus.success,
            reason: "auto_reply:dm",
            createdAt: { gte: helpSince },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: { meta: true, createdAt: true },
        });

        const lastForUser = recent.find((r) => metaString(r.meta, "targetUserId") === event.sender_id);
        const lastUrl = lastForUser ? metaString(lastForUser.meta, "linkUrl") : null;
        const lastTracked = lastForUser ? metaBoolean(lastForUser.meta, "linkTracked") : null;
        if (lastUrl && lastTracked === true) {
          link = {
            tracked: true,
            url: lastUrl,
            token: lastForUser ? metaString(lastForUser.meta, "trackingToken") : null,
            trackingLinkId: lastForUser ? metaString(lastForUser.meta, "trackingLinkId") : null,
          };
        } else {
          link = await createTrackingUrl({
            baseUrl: settings.publicBaseUrl ?? null,
            destinationUrl,
            label: `x_dm_link:${linkBucket}:${linkSource}`,
          });
        }
      } else if (intent === "link") {
        link = await createTrackingUrl({
          baseUrl: settings.publicBaseUrl ?? null,
          destinationUrl,
          label: `x_dm_link:${linkBucket}:${linkSource}`,
        });
      }

      const linkUrl = intent === "link" || intent === "help" ? link.url : null;
      const linkTracked = intent === "link" || intent === "help" ? link.tracked : false;
      const trackingToken = intent === "link" || intent === "help" ? link.token : null;
      const trackingLinkId = intent === "link" || intent === "help" ? link.trackingLinkId : null;

      const built: BuiltMessage | null = shouldAutoReply
        ? intent === "help"
          ? buildHelpMessageV2({ url: linkUrl ?? destinationUrl, disclaimer, seed: seedFrom([event.id, event.sender_id, "help"]) })
          : buildLinkMessageV2({
              url: linkUrl ?? destinationUrl,
              disclaimer,
              linkCode: linkCode ? `LINK ${linkCode.toUpperCase()}` : null,
              linkBucket,
              seed: seedFrom([event.id, event.sender_id, "link", linkBucket]),
            })
        : shouldSendMenu
          ? { templateKey: "menu:v1", text: makeMenuMessage({ disclaimer }) }
          : null;

      const msg = built?.text ?? null;
      const msgTemplateKey = built?.templateKey ?? null;

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
              linkBucket,
              linkSource,
              linkTracked,
              linkUrl,
              trackingToken,
              trackingLinkId,
              msg,
              msgTemplateKey,
              shouldAutoReply,
              shouldSendMenu,
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
        // Always log ambassador leads for Devon follow-up, but keep replies manual (with a menu safety net).
        if (intent === "ambassador") {
          try {
            const prospectId = await upsertProspectForAmbassadorLead({
              xUserId: event.sender_id,
              note: `Inbound AMBASSADOR DM.\n\nMessage:\n${event.text}`,
            });

            if (prospectId) {
              await prisma.outreachEvent.create({
                data: {
                  prospectId,
                  channel: OutreachChannel.dm,
                  eventType: "ambassador_inbound",
                  notes: event.text,
                },
                select: { id: true },
              });
            }
          } catch {
            // ignore: best-effort CRM logging
          }
        }

        if (!msg) {
          await prisma.xActionLog.create({
            data: {
              actionType: XActionType.dm,
              status: XActionStatus.skipped,
              reason: "manual:dm_needed",
              meta: {
                sourceDmEventId: event.id,
                targetUserId: event.sender_id,
                intent,
                note: "manual reply needed (no auto response sent)",
              },
            },
            select: { id: true },
          });
          await markHandledItemDone({ type: XHandledItemType.dm_event, externalId: event.id });
          continue;
        }

        const sent = await sendDm({
          accessToken,
          participantId: event.sender_id,
          text: msg,
        });

        await prisma.xActionLog.create({
          data: {
            actionType: XActionType.dm,
            status: XActionStatus.success,
            reason: shouldAutoReply ? "auto_reply:dm" : "auto_reply:dm_menu",
            xId: sent.data?.dm_event_id ?? null,
            meta: {
              sourceDmEventId: event.id,
              targetUserId: event.sender_id,
              intent,
              linkCode,
              linkBucket,
              linkSource,
              linkTracked,
              linkUrl,
              trackingToken,
              trackingLinkId,
              msg,
              msgTemplateKey,
            },
          },
        });

        try {
          const externalId =
            sent.data?.dm_event_id ??
            `x_out_${event.id}_${crypto.randomBytes(6).toString("hex")}`;
          await prisma.conversationMessage.create({
            data: {
              platform: "x",
              externalId,
              threadKey: xDmThreadKey(event.sender_id),
              direction: "outbound",
              userId: event.sender_id,
              text: redactMessageText(msg),
              createdAt: new Date(),
                  meta: {
                    reason: shouldAutoReply ? "auto_reply:dm" : "auto_reply:dm_menu",
                    intent,
                    msgTemplateKey,
                    linkBucket,
                    linkSource,
                    linkTracked,
                    trackingToken,
                    trackingLinkId,
                  } as Prisma.InputJsonValue,
            },
          });
        } catch {
          // ignore: logging is best-effort
        }

        if (!shouldAutoReply) menuSentUserIds.add(event.sender_id);

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
                linkBucket,
                linkSource,
                linkTracked,
                linkUrl,
                trackingToken,
                trackingLinkId,
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

  // Follow-up nurture: if a user received a tracked link DM 12–36 hours ago and hasn't clicked, send one gentle reminder.
  // Guardrails:
  // - counts toward maxAutoRepliesPerDay (reason contains "auto_reply")
  // - max 3 follow-ups per run
  // - max 30/day (or 25% of maxAutoRepliesPerDay, whichever is lower)
  try {
    const remainingActions = Math.max(0, remaining - (repliesSent + dmsSent));
    const maxDailyFollowUps = Math.min(30, Math.floor(settings.maxAutoRepliesPerDay * 0.25));

    if (!args.dryRun && remainingActions > 0 && maxDailyFollowUps > 0 && settings.publicBaseUrl) {
      const followUpsAlreadyToday = await prisma.xActionLog.count({
        where: {
          actionType: XActionType.dm,
          status: XActionStatus.success,
          reason: "auto_reply:dm_followup",
          createdAt: { gte: dayStart, lt: dayEnd },
        },
      });
      const remainingDailyFollowUps = Math.max(0, maxDailyFollowUps - followUpsAlreadyToday);
      const maxThisRun = Math.min(3, remainingActions, remainingDailyFollowUps);

      if (maxThisRun > 0) {
        const nowMs = Date.now();
        const minAgeMs = 12 * 60 * 60 * 1000;
        const maxAgeMs = 36 * 60 * 60 * 1000;
        const since = new Date(nowMs - maxAgeMs);

        const recentLinkDms = await prisma.xActionLog.findMany({
          where: {
            actionType: XActionType.dm,
            status: XActionStatus.success,
            reason: "auto_reply:dm",
            createdAt: { gte: since },
          },
          orderBy: { createdAt: "desc" },
          take: 2000,
          select: { id: true, createdAt: true, meta: true },
        });

        const candidates = recentLinkDms
          .map((r) => {
            const intent = metaString(r.meta, "intent");
            if (intent !== "link") return null;
            const tracked = metaBoolean(r.meta, "linkTracked") ?? false;
            if (!tracked) return null;
            const targetUserId = metaString(r.meta, "targetUserId");
            const trackingToken = metaString(r.meta, "trackingToken");
            if (!targetUserId || !trackingToken) return null;

            return {
              id: r.id,
              createdAt: r.createdAt,
              targetUserId,
              trackingToken,
              trackingLinkId: metaString(r.meta, "trackingLinkId"),
              linkUrl: metaString(r.meta, "linkUrl"),
              linkBucket: metaString(r.meta, "linkBucket") ?? "unknown",
              linkSource: metaString(r.meta, "linkSource") ?? "unknown",
            };
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x));

        // Only follow up the most recent LINK DM per user, to avoid spam when they request multiple times.
        const latestByTarget = new Map<string, (typeof candidates)[number]>();
        for (const c of candidates) {
          const existing = latestByTarget.get(c.targetUserId);
          if (!existing || c.createdAt > existing.createdAt) latestByTarget.set(c.targetUserId, c);
        }

        let sentNow = 0;
        for (const c of latestByTarget.values()) {
          if (sentNow >= maxThisRun) break;
          const ageMs = nowMs - c.createdAt.getTime();
          if (ageMs < minAgeMs || ageMs > maxAgeMs) continue;

          const linkId =
            c.trackingLinkId ||
            (await prisma.trackingLink
              .findUnique({ where: { token: c.trackingToken }, select: { id: true } })
              .then((x) => x?.id ?? null));
          if (!linkId) continue;

          const clicks = await prisma.clickEvent.count({
            where: { trackingLinkId: linkId, createdAt: { gte: c.createdAt } },
          });
          if (clicks > 0) continue;

          const reserved = await reserveHandledItem({
            type: XHandledItemType.dm_event,
            externalId: `followup:${c.trackingToken}`,
            retryErroredAfterMs: 12 * 60 * 60 * 1000,
          });
          if (!reserved) continue;

          const baseUrl = settings.publicBaseUrl.replace(/\/+$/, "");
          const url = c.linkUrl ?? `${baseUrl}/r/${c.trackingToken}`;
          const builtFollowUp = buildFollowUpMessageV2({
            url,
            disclaimer,
            seed: seedFrom([c.trackingToken, c.targetUserId, "followup"]),
          });
          const followUpText = builtFollowUp.text;
          const followUpTemplateKey = builtFollowUp.templateKey;

          try {
            const sent = await sendDm({
              accessToken,
              participantId: c.targetUserId,
              text: followUpText,
            });

            await prisma.xActionLog.create({
              data: {
                actionType: XActionType.dm,
                status: XActionStatus.success,
                reason: "auto_reply:dm_followup",
                xId: sent.data?.dm_event_id ?? null,
                meta: {
                  targetUserId: c.targetUserId,
                  trackingToken: c.trackingToken,
                  trackingLinkId: linkId,
                  linkBucket: c.linkBucket,
                  linkSource: c.linkSource,
                  linkUrl: url,
                  followUpText,
                  followUpTemplateKey,
                  originalDmLogId: c.id,
                },
              },
            });

            try {
              const externalId =
                sent.data?.dm_event_id ??
                `x_followup_${c.trackingToken}_${crypto.randomBytes(6).toString("hex")}`;
              await prisma.conversationMessage.create({
                data: {
                  platform: "x",
                  externalId,
                  threadKey: xDmThreadKey(c.targetUserId),
                  direction: "outbound",
                  userId: c.targetUserId,
                  text: redactMessageText(followUpText),
                  createdAt: new Date(),
                  meta: {
                    reason: "auto_reply:dm_followup",
                    followUpTemplateKey,
                    trackingToken: c.trackingToken,
                    trackingLinkId: linkId,
                    linkBucket: c.linkBucket,
                    linkSource: c.linkSource,
                    linkUrl: url,
                  } as Prisma.InputJsonValue,
                },
              });
            } catch {
              // ignore: logging is best-effort
            }

            await markHandledItemDone({
              type: XHandledItemType.dm_event,
              externalId: `followup:${c.trackingToken}`,
            });

            followUpsSent += 1;
            sentNow += 1;
          } catch (err) {
            try {
              await prisma.xActionLog.create({
                data: {
                  actionType: XActionType.dm,
                  status: XActionStatus.error,
                  reason: "auto_reply:dm_followup_error",
                  meta: {
                    targetUserId: c.targetUserId,
                    trackingToken: c.trackingToken,
                    trackingLinkId: linkId,
                    linkBucket: c.linkBucket,
                    linkSource: c.linkSource,
                    message: err instanceof Error ? err.message : String(err),
                  },
                },
              });
            } catch {
              // ignore
            }
            try {
              await markHandledItemError({
                type: XHandledItemType.dm_event,
                externalId: `followup:${c.trackingToken}`,
                error: err,
              });
            } catch {
              // ignore
            }
          }
        }
      }
    }
  } catch {
    // ignore: nurture is best-effort
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
        followUpsSent,
        postsRead,
        mentionError,
        dmError,
        newestMentionIdSeen,
        newestDmEventIdSeen,
      },
    },
  });

  return {
    status: "processed",
    mentionsScanned,
    dmsScanned,
    repliesSent,
    dmsSent,
    followUpsSent,
    postsRead,
  };
}
