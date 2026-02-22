import { prisma, XActionStatus, XActionType } from "@el-dorado/db";
import { ensureAccessToken } from "./credentials";
import { postTweet } from "./write";
import { addDaysUtc, getAppTimeZone, getSlotInstantForTodayApp, startOfDayApp } from "../time";

type AutoPostResult =
  | { status: "skipped"; reason: string }
  | { status: "posted"; slot: string; xId?: string };

function pickFrom<T>(items: T[], seed: number): T {
  const idx = Math.abs(seed) % items.length;
  return items[idx]!;
}

function clampText(text: string, max = 275): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function buildPostText(args: { slotIndex: number; daySeed: number; disclaimer: string }) {
  const depositMethods = [
    "Cash App",
    "Venmo",
    "Zelle",
    "PayPal",
    "Apple Pay",
    "crypto",
  ];

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

  const cta = pickFrom(
    [
      "Reply LINK for the signup link + bonus details.",
      "Reply LINK for signup + bonus info.",
      "Reply LINK and we’ll send the signup link.",
    ],
    args.daySeed + args.slotIndex * 41,
  );

  const education = pickFrom(
    [
      "Quick reminder: manage bankroll like a business—size bets, track results, avoid chasing.",
      "Best bettors stay consistent: track units, shop lines, and avoid tilt.",
      "If you’re betting weekly: focus on process (not one-game outcomes).",
    ],
    args.daySeed + args.slotIndex * 23,
  );

  const community = pickFrom(
    [
      "What’s your favorite market tonight—spread, total, props, or parlays?",
      "Are you betting props or sides today?",
      "What are you watching tonight? (NFL/NBA/MLB/NHL/other)",
    ],
    args.daySeed + args.slotIndex * 29,
  );

  const footer = args.disclaimer ? `\n\n${args.disclaimer}` : "";

  if (args.slotIndex === 0) {
    return clampText(`${promoLine} ${methodsLine} ${cta}${footer}`);
  }
  if (args.slotIndex === 1) {
    return clampText(`${education} ${promoLine} ${cta}${footer}`);
  }
  return clampText(`${community} ${cta}${footer}`);
}

function parsePostSchedule(schedule: unknown): string[] {
  if (!schedule || typeof schedule !== "object") return ["11:00", "16:00", "21:30"];
  const posts = (schedule as { posts?: unknown }).posts;
  if (!Array.isArray(posts)) return ["11:00", "16:00", "21:30"];
  return posts
    .map((x: unknown) => String(x ?? "").trim())
    .filter((x: string) => /^\d{2}:\d{2}$/.test(x))
    .slice(0, 3);
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
      maxPostsPerDay: 3,
      maxAutoRepliesPerDay: 60,
      maxOutboundRepliesPerDay: 10,
      schedule: { posts: ["11:00", "16:00", "21:30"] },
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
  const dayEnd = startOfDayApp(addDaysUtc(now, 1), tz);

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
    const text = buildPostText({ slotIndex: i, daySeed, disclaimer });

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

    const accessToken = await ensureAccessToken();
    const posted = await postTweet({ accessToken, text });

    await prisma.xActionLog.create({
      data: {
        actionType: XActionType.post,
        status: XActionStatus.success,
        reason: `autopost:${slot}`,
        xId: posted.id ?? null,
        meta: { slot, tz, text },
      },
    });

    return { status: "posted", slot, xId: posted.id };
  }

  return { status: "skipped", reason: "no_due_slot" };
}
