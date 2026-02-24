import { prisma, XActionStatus, XActionType, XHandledItemType } from "@el-dorado/db";
import { ensureAccessToken } from "./credentials";
import { postTweet } from "./write";
import { getAppTimeZone, getSlotInstantForTodayApp, startOfDayApp, startOfNextDayApp } from "../time";
import { markHandledItemDone, markHandledItemError, reserveHandledItem } from "./handled";

type AutoPostResult =
  | { status: "skipped"; reason: string }
  | { status: "posted"; slot: string; xId?: string };

const DEFAULT_POST_SCHEDULE = ["10:00", "12:30", "15:30", "18:30", "21:00", "23:30"];

function pickFrom<T>(items: T[], seed: number): T {
  const idx = Math.abs(seed) % items.length;
  return items[idx]!;
}

function clampText(text: string, max = 275): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function getPromoSlots(postsPerDay: number): number[] {
  const n = Math.max(1, Math.min(postsPerDay, 6));
  if (n >= 6) return [0, 3];
  if (n === 5) return [0, 3];
  if (n === 4) return [0, 2];
  return [0];
}

function makeSoftCta(args: { daySeed: number; slotIndex: number }): string {
  return pickFrom(
    [
      "If you need the signup link, DM LINK.",
      "Want the signup link? DM LINK.",
      "DM LINK if you want the signup link + bonus info.",
    ],
    args.daySeed + args.slotIndex * 101,
  );
}

function buildPostText(args: {
  slotIndex: number;
  daySeed: number;
  disclaimer: string;
  postsPerDay: number;
}): string {
  const depositMethods = ["Cash App", "Venmo", "Zelle", "PayPal", "Apple Pay", "crypto"];

  const methodsLine = pickFrom(
    [
      `Multiple deposit options: ${depositMethods.slice(0, 4).join(", ")} + more.`,
      `Deposit options include ${depositMethods.slice(0, 3).join(", ")} + more.`,
      `Deposit methods: ${depositMethods.slice(0, 2).join(", ")}, ${depositMethods[2]}, ${depositMethods[3]}, and more.`,
    ],
    args.daySeed + args.slotIndex * 17,
  );

  const promoLine = pickFrom(
    [
      "200% deposit match (Free Play bonus).",
      "Claim a 200% deposit match (Free Play bonus).",
      "200% match available (Free Play bonus).",
    ],
    args.daySeed + args.slotIndex * 31,
  );

  const promoCta = pickFrom(
    [
      "Reply LINK for the signup link + bonus details.",
      "Reply LINK for signup + bonus info.",
      "Reply LINK and we'll send the signup link.",
    ],
    args.daySeed + args.slotIndex * 41,
  );

  const education = pickFrom(
    [
      "Quick reminder: manage bankroll like a business—size bets, track results, avoid chasing.",
      "Best bettors stay consistent: track units, shop lines, and avoid tilt.",
      "If you're betting weekly: focus on process (not one-game outcomes).",
    ],
    args.daySeed + args.slotIndex * 23,
  );

  const community = pickFrom(
    [
      "What's your favorite market tonight—spread, total, props, or parlays?",
      "Are you betting props or sides today?",
      "What are you watching tonight? (NFL/NBA/MLB/NHL/other)",
    ],
    args.daySeed + args.slotIndex * 29,
  );

  const footer = args.disclaimer ? `\n\n${args.disclaimer}` : "";

  const promoSlots = getPromoSlots(args.postsPerDay);
  const isPromo = promoSlots.includes(args.slotIndex);

  if (isPromo) {
    return clampText(`${promoLine} ${methodsLine} ${promoCta}${footer}`);
  }

  const softCta = makeSoftCta({ daySeed: args.daySeed, slotIndex: args.slotIndex });
  const variant = args.slotIndex % 3;
  if (variant === 0) return clampText(`${education} ${softCta}${footer}`);
  if (variant === 1) return clampText(`${community} ${softCta}${footer}`);
  return clampText(`${education} ${community} ${softCta}${footer}`);
}

function parsePostSchedule(schedule: unknown): string[] {
  if (!schedule || typeof schedule !== "object") return DEFAULT_POST_SCHEDULE;
  const posts = (schedule as { posts?: unknown }).posts;
  if (!Array.isArray(posts)) return DEFAULT_POST_SCHEDULE;
  const parsed = posts
    .map((x: unknown) => String(x ?? "").trim())
    .filter((x: string) => /^\d{2}:\d{2}$/.test(x))
    .slice(0, 6);
  return parsed.length ? parsed : DEFAULT_POST_SCHEDULE;
}

export async function runAutoPost(args: { dryRun: boolean }): Promise<AutoPostResult> {
  const settings = await prisma.xAccountSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      enabled: false,
      autoPostEnabled: false,
      autoReplyEnabled: false,
      outboundEnabled: false,
      maxPostsPerDay: 6,
      maxAutoRepliesPerDay: 60,
      maxOutboundRepliesPerDay: 200,
      maxOutboundRepliesPerRun: 10,
      schedule: { posts: DEFAULT_POST_SCHEDULE },
      disclaimerText: "21+ | Terms apply | Gamble responsibly",
    },
    select: {
      enabled: true,
      autoPostEnabled: true,
      maxPostsPerDay: true,
      schedule: true,
      disclaimerText: true,
    },
  });

  if (!settings.enabled) return { status: "skipped", reason: "x_settings_disabled" };
  if (!settings.autoPostEnabled) return { status: "skipped", reason: "autopost_disabled" };

  const now = new Date();
  const tz = getAppTimeZone(); // default America/New_York
  const dayStart = startOfDayApp(now, tz);
  const dayEnd = startOfNextDayApp(now, tz);

  const postsToday = await prisma.xActionLog.count({
    where: {
      actionType: XActionType.post,
      status: XActionStatus.success,
      createdAt: { gte: dayStart, lt: dayEnd },
    },
  });

  if (postsToday >= settings.maxPostsPerDay) {
    return { status: "skipped", reason: "max_posts_per_day_reached" };
  }

  const slots = parsePostSchedule(settings.schedule);
  if (!slots.length) return { status: "skipped", reason: "no_slots_configured" };

  const postsPerDayPlanned = Math.max(1, Math.min(settings.maxPostsPerDay, slots.length, 6));

  // Find earliest missed slot for today that hasn't been posted.
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i]!;
    const slotInstant = getSlotInstantForTodayApp({ timeHHMM: slot, now, timeZone: tz });
    if (now.getTime() < slotInstant.getTime()) continue;

    const already = await prisma.xActionLog.findFirst({
      where: {
        actionType: XActionType.post,
        status: XActionStatus.success,
        reason: `autopost:${slot}`,
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      select: { id: true },
    });
    if (already) continue;

    const daySeed = Number(dayStart.getTime() / 1000);
    const disclaimer =
      (settings.disclaimerText && String(settings.disclaimerText).trim()) ||
      "21+ | Terms apply | Gamble responsibly";
    const text = buildPostText({ slotIndex: i, daySeed, disclaimer, postsPerDay: postsPerDayPlanned });

    if (args.dryRun) {
      await prisma.xActionLog.create({
        data: {
          actionType: XActionType.post,
          status: XActionStatus.skipped,
          reason: `autopost:${slot}`,
          meta: { dryRun: true, slot, tz, text },
        },
      });
      return { status: "skipped", reason: "dry_run" };
    }

    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const externalId = `${ymd}|${slot}`;

    const reserved = await reserveHandledItem({
      type: XHandledItemType.autopost_slot,
      externalId,
      retryErroredAfterMs: 60 * 60 * 1000,
    });
    if (!reserved) return { status: "skipped", reason: "autopost_slot_already_reserved" };

    try {
      const accessToken = await ensureAccessToken();
      const posted = await postTweet({ accessToken, text });

      await prisma.xActionLog.create({
        data: {
          actionType: XActionType.post,
          status: XActionStatus.success,
          reason: `autopost:${slot}`,
          xId: posted.id ?? null,
          meta: { slot, tz, text, externalId },
        },
      });

      await markHandledItemDone({ type: XHandledItemType.autopost_slot, externalId });
      return { status: "posted", slot, xId: posted.id };
    } catch (err) {
      try {
        await prisma.xActionLog.create({
          data: {
            actionType: XActionType.post,
            status: XActionStatus.error,
            reason: `autopost:${slot}:error`,
            meta: { slot, tz, text, externalId, message: err instanceof Error ? err.message : String(err) },
          },
        });
      } catch {
        // ignore
      }
      try {
        await markHandledItemError({ type: XHandledItemType.autopost_slot, externalId, error: err });
      } catch {
        // ignore
      }
      return { status: "skipped", reason: "autopost_post_error" };
    }
  }

  return { status: "skipped", reason: "no_due_slot" };
}

