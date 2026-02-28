import { prisma } from "@el-dorado/db";
import Link from "next/link";
import { upsertWeeklyDepositResultAction } from "./serverActions";

export const dynamic = "force-dynamic";

function daysAgoUtc(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export default async function ReportsPage() {
  const since7 = daysAgoUtc(7);
  const since30 = daysAgoUtc(30);

  const isObj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === "object";
  const metaString = (meta: unknown, key: string): string | null => {
    if (!isObj(meta)) return null;
    const v = meta[key];
    return typeof v === "string" ? v : null;
  };

  const metaBoolean = (meta: unknown, key: string): boolean | null => {
    if (!isObj(meta)) return null;
    const v = meta[key];
    return typeof v === "boolean" ? v : null;
  };

  const clickAgg30 = await prisma.clickEvent.groupBy({
    by: ["trackingLinkId"],
    where: { createdAt: { gte: since30 } },
    _count: { _all: true },
  });
  const clickAgg7 = await prisma.clickEvent.groupBy({
    by: ["trackingLinkId"],
    where: { createdAt: { gte: since7 } },
    _count: { _all: true },
  });

  const clickCount30ByLinkId = new Map(clickAgg30.map((r) => [r.trackingLinkId, r._count._all]));
  const clickCount7ByLinkId = new Map(clickAgg7.map((r) => [r.trackingLinkId, r._count._all]));

  const clickLinkIds = Array.from(
    new Set<string>([...clickAgg30.map((r) => r.trackingLinkId), ...clickAgg7.map((r) => r.trackingLinkId)]),
  );

  const clickLinks = clickLinkIds.length
    ? await prisma.trackingLink.findMany({
        where: { id: { in: clickLinkIds } },
        select: { id: true, label: true },
      })
    : [];

  const linkLabelById = new Map(clickLinks.map((l) => [l.id, l.label ?? null]));

  const parseDmLinkLabel = (label: string | null): { bucket: string; source: string } | null => {
    if (!label) return null;
    if (label.startsWith("x_dm_link:")) {
      const [, bucket, source] = label.split(":");
      if (!bucket) return null;
      return { bucket, source: source || "unknown" };
    }
    if (label.startsWith("x_link:")) {
      const [, bucket] = label.split(":");
      if (!bucket) return null;
      return { bucket, source: "unknown" };
    }
    return null;
  };

  const clicks7ByBucket = new Map<string, number>();
  const clicks30ByBucket = new Map<string, number>();
  const clicks7ByBucketSource = new Map<string, number>();
  const clicks30ByBucketSource = new Map<string, number>();

  for (const r of clickAgg30) {
    const parsed = parseDmLinkLabel(linkLabelById.get(r.trackingLinkId) ?? null);
    if (!parsed) continue;
    const n = r._count._all;
    clicks30ByBucket.set(parsed.bucket, (clicks30ByBucket.get(parsed.bucket) ?? 0) + n);
    clicks30ByBucketSource.set(
      `${parsed.bucket}::${parsed.source}`,
      (clicks30ByBucketSource.get(`${parsed.bucket}::${parsed.source}`) ?? 0) + n,
    );
  }

  for (const r of clickAgg7) {
    const parsed = parseDmLinkLabel(linkLabelById.get(r.trackingLinkId) ?? null);
    if (!parsed) continue;
    const n = r._count._all;
    clicks7ByBucket.set(parsed.bucket, (clicks7ByBucket.get(parsed.bucket) ?? 0) + n);
    clicks7ByBucketSource.set(
      `${parsed.bucket}::${parsed.source}`,
      (clicks7ByBucketSource.get(`${parsed.bucket}::${parsed.source}`) ?? 0) + n,
    );
  }

  const outboundLogs30 = await prisma.xActionLog.findMany({
    where: { createdAt: { gte: since30 }, actionType: "outbound_comment" },
    orderBy: { createdAt: "desc" },
    take: 10000,
    select: { createdAt: true, status: true, meta: true, reason: true },
  });

  const inboundDmLogs30 = await prisma.xActionLog.findMany({
    where: { createdAt: { gte: since30 }, actionType: "dm" },
    orderBy: { createdAt: "desc" },
    take: 10000,
    select: { createdAt: true, status: true, meta: true, reason: true },
  });

  const outboundSuccess30 = outboundLogs30.filter((r) => r.status === "success");

  const outboundByTier30 = new Map<string, number>();
  const outboundByTier7 = new Map<string, number>();
  const outboundByTierQuery30 = new Map<string, number>();

  for (const r of outboundSuccess30) {
    const tier = metaString(r.meta, "tier") ?? (r.reason?.replace(/^outbound:/, "") ?? "unknown");
    outboundByTier30.set(tier, (outboundByTier30.get(tier) ?? 0) + 1);

    if (r.createdAt >= since7) outboundByTier7.set(tier, (outboundByTier7.get(tier) ?? 0) + 1);

    const query = metaString(r.meta, "query") ?? "unknown";
    outboundByTierQuery30.set(`${tier}::${query}`, (outboundByTierQuery30.get(`${tier}::${query}`) ?? 0) + 1);
  }

  const dmSuccess30 = inboundDmLogs30.filter((r) => r.status === "success");
  const dmMenu30 = dmSuccess30.filter((r) => r.reason === "auto_reply:dm_menu");
  const dmAuto30 = dmSuccess30.filter((r) => r.reason === "auto_reply:dm");
  const dmFollowUp30 = dmSuccess30.filter((r) => r.reason === "auto_reply:dm_followup");

  type TemplateStat = {
    key: string;
    sent7: number;
    sent30: number;
    clicked7: number;
    clicked30: number;
  };

  const templateStats = new Map<string, TemplateStat>();
  for (const r of dmAuto30) {
    const key = metaString(r.meta, "msgTemplateKey") ?? "unknown";
    const linkId = metaString(r.meta, "trackingLinkId");
    const clicked30 = Boolean(linkId && (clickCount30ByLinkId.get(linkId) ?? 0) > 0);
    const clicked7 = Boolean(linkId && (clickCount7ByLinkId.get(linkId) ?? 0) > 0);

    const s = templateStats.get(key) ?? { key, sent7: 0, sent30: 0, clicked7: 0, clicked30: 0 };
    s.sent30 += 1;
    if (clicked30) s.clicked30 += 1;
    if (r.createdAt >= since7) {
      s.sent7 += 1;
      if (clicked7) s.clicked7 += 1;
    }
    templateStats.set(key, s);
  }
  const templateRows = Array.from(templateStats.values()).sort((a, b) => b.sent30 - a.sent30);

  const followUpStats = new Map<string, TemplateStat>();
  for (const r of dmFollowUp30) {
    const key = metaString(r.meta, "followUpTemplateKey") ?? "unknown";
    const linkId = metaString(r.meta, "trackingLinkId");
    const clicked30 = Boolean(linkId && (clickCount30ByLinkId.get(linkId) ?? 0) > 0);
    const clicked7 = Boolean(linkId && (clickCount7ByLinkId.get(linkId) ?? 0) > 0);

    const s = followUpStats.get(key) ?? { key, sent7: 0, sent30: 0, clicked7: 0, clicked30: 0 };
    s.sent30 += 1;
    if (clicked30) s.clicked30 += 1;
    if (r.createdAt >= since7) {
      s.sent7 += 1;
      if (clicked7) s.clicked7 += 1;
    }
    followUpStats.set(key, s);
  }
  const followUpRows = Array.from(followUpStats.values()).sort((a, b) => b.sent30 - a.sent30);

  const linkDmSuccess30 = dmSuccess30.filter((r) => metaString(r.meta, "intent") === "link");

  const linkRequestsByBucket30 = new Map<string, number>();
  const linkRequestsByBucket7 = new Map<string, number>();
  const linkRequestsBySource30 = new Map<string, number>();
  const linkRequestsBySource7 = new Map<string, number>();
  let linkRequestsUntracked30 = 0;
  let linkRequestsUntracked7 = 0;
  for (const r of linkDmSuccess30) {
    const bucket = metaString(r.meta, "linkBucket") ?? "unknown";
    linkRequestsByBucket30.set(bucket, (linkRequestsByBucket30.get(bucket) ?? 0) + 1);
    if (r.createdAt >= since7) linkRequestsByBucket7.set(bucket, (linkRequestsByBucket7.get(bucket) ?? 0) + 1);

    const source = metaString(r.meta, "linkSource") ?? "unknown";
    linkRequestsBySource30.set(source, (linkRequestsBySource30.get(source) ?? 0) + 1);
    if (r.createdAt >= since7) linkRequestsBySource7.set(source, (linkRequestsBySource7.get(source) ?? 0) + 1);

    const tracked = metaBoolean(r.meta, "linkTracked") ?? false;
    if (!tracked) {
      linkRequestsUntracked30 += 1;
      if (r.createdAt >= since7) linkRequestsUntracked7 += 1;
    }
  }

  const topOutboundQueries30 = Array.from(outboundByTierQuery30.entries())
    .map(([key, count]) => {
      const idx = key.indexOf("::");
      const tier = idx >= 0 ? key.slice(0, idx) : key;
      const query = idx >= 0 ? key.slice(idx + 2) : "unknown";
      return { tier, query, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const depositorFunnelRows = [
    { key: "payout_reviews", label: "Payout/cashout reviews" },
    { key: "picks_parlays", label: "Picks/parlays/props" },
    { key: "general", label: "General sportsbook chatter" },
    { key: "default", label: "Default LINK (no code)" },
  ] as const;

  const redditLinkRequests7 = linkRequestsBySource7.get("reddit") ?? 0;
  const redditLinkRequests30 = linkRequestsBySource30.get("reddit") ?? 0;

  const sumClicksForSource = (m: Map<string, number>, source: string): number => {
    let sum = 0;
    for (const [k, v] of m) {
      if (k.endsWith(`::${source}`)) sum += v;
    }
    return sum;
  };
  const redditClicks7 = sumClicksForSource(clicks7ByBucketSource, "reddit");
  const redditClicks30 = sumClicksForSource(clicks30ByBucketSource, "reddit");

  const redditOutbound30 = await prisma.conversationMessage.findMany({
    where: { platform: "reddit", direction: "outbound", createdAt: { gte: since30 } },
    orderBy: { createdAt: "desc" },
    take: 10000,
    select: { createdAt: true, meta: true },
  });

  const redditByTier30 = new Map<string, number>();
  const redditByTier7 = new Map<string, number>();
  let redditCta30 = 0;
  let redditCta7 = 0;
  for (const r of redditOutbound30) {
    const tier = metaString(r.meta, "tier") ?? "unknown";
    redditByTier30.set(tier, (redditByTier30.get(tier) ?? 0) + 1);
    const usedCta = metaBoolean(r.meta, "usedCta") ?? false;
    if (usedCta) redditCta30 += 1;

    if (r.createdAt >= since7) {
      redditByTier7.set(tier, (redditByTier7.get(tier) ?? 0) + 1);
      if (usedCta) redditCta7 += 1;
    }
  }

  const weeklyDepositResults = await prisma.weeklyDepositResult.findMany({
    orderBy: { weekStart: "desc" },
    take: 30,
    include: { campaign: { select: { id: true, name: true, type: true } } },
  });

  const campaigns = await prisma.campaign.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, type: true },
  });

  const weeklyResults30 = await prisma.outreachEvent.groupBy({
    by: ["prospectId"],
    where: {
      eventAt: { gte: since30 },
      eventType: { equals: "weekly_results", mode: "insensitive" },
    },
    _sum: { depositors: true, depositsUsd: true },
    _count: { _all: true },
    _max: { eventAt: true },
    orderBy: { _sum: { depositsUsd: "desc" } },
    take: 20,
  });

  const weeklyProspectIds = weeklyResults30.map((r) => r.prospectId);
  const weeklyProspects = weeklyProspectIds.length
    ? await prisma.prospect.findMany({
        where: { id: { in: weeklyProspectIds } },
        select: { id: true, handle: true, owner: true, status: true },
      })
    : [];
  const weeklyProspectById = new Map(weeklyProspects.map((p) => [p.id, p]));

  const totalDepositors30 = weeklyResults30.reduce((sum, r) => sum + (r._sum.depositors ?? 0), 0);
  const totalDepositsUsd30 = weeklyResults30.reduce((sum, r) => sum + (r._sum.depositsUsd ?? 0), 0);

  const clickRows30 = await prisma.clickEvent.groupBy({
    by: ["trackingLinkId"],
    where: { createdAt: { gte: since30 } },
    _count: { _all: true },
  });
  const clickRows7 = await prisma.clickEvent.groupBy({
    by: ["trackingLinkId"],
    where: { createdAt: { gte: since7 } },
    _count: { _all: true },
  });

  const clicks30ByLink = new Map(clickRows30.map((r) => [r.trackingLinkId, r._count._all]));
  const clicks7ByLink = new Map(clickRows7.map((r) => [r.trackingLinkId, r._count._all]));

  const linkIds = Array.from(
    new Set<string>([...clicks30ByLink.keys(), ...clicks7ByLink.keys()]),
  );
  const links = linkIds.length
    ? await prisma.trackingLink.findMany({
        where: { id: { in: linkIds } },
        select: {
          id: true,
          campaign: { select: { id: true, name: true, type: true } },
        },
      })
    : [];

  const campaignAgg = new Map<
    string,
    { id: string; name: string; type: string; clicks7: number; clicks30: number }
  >();
  for (const l of links) {
    const c = l.campaign;
    const existing = campaignAgg.get(c.id) ?? {
      id: c.id,
      name: c.name,
      type: c.type,
      clicks7: 0,
      clicks30: 0,
    };
    existing.clicks7 += clicks7ByLink.get(l.id) ?? 0;
    existing.clicks30 += clicks30ByLink.get(l.id) ?? 0;
    campaignAgg.set(c.id, existing);
  }
  const topCampaigns = Array.from(campaignAgg.values())
    .sort((a, b) => b.clicks30 - a.clicks30)
    .slice(0, 12);

  const contacted7 = await prisma.outreachEvent.count({
    where: { eventAt: { gte: since7 }, eventType: { equals: "contacted", mode: "insensitive" } },
  });
  const replied7 = await prisma.outreachEvent.count({
    where: { eventAt: { gte: since7 }, eventType: { equals: "replied", mode: "insensitive" } },
  });
  const signed7 = await prisma.outreachEvent.count({
    where: { eventAt: { gte: since7 }, eventType: { equals: "signed", mode: "insensitive" } },
  });

  const contacted30 = await prisma.outreachEvent.count({
    where: { eventAt: { gte: since30 }, eventType: { equals: "contacted", mode: "insensitive" } },
  });
  const replied30 = await prisma.outreachEvent.count({
    where: { eventAt: { gte: since30 }, eventType: { equals: "replied", mode: "insensitive" } },
  });
  const signed30 = await prisma.outreachEvent.count({
    where: { eventAt: { gte: since30 }, eventType: { equals: "signed", mode: "insensitive" } },
  });

  const queryRows = await prisma.prospect.groupBy({
    by: ["firstDiscoveredQueryId"],
    where: { firstDiscoveredQueryId: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 30,
  });

  const queryStats = await Promise.all(
    queryRows.map(async (row) => {
      const queryId = row.firstDiscoveredQueryId!;
      const discovered = row._count.id;
      const queuedEver = await prisma.prospect.count({
        where: { firstDiscoveredQueryId: queryId, queuedAt: { not: null } },
      });
      const signed = await prisma.prospect.count({
        where: { firstDiscoveredQueryId: queryId, status: "signed" },
      });
      const queuedRate = discovered ? queuedEver / discovered : 0;
      const signedRate = discovered ? signed / discovered : 0;
      const yieldScore = queuedRate * 0.85 + signedRate * 0.15;
      return { queryId, discovered, queuedEver, signed, yieldScore };
    }),
  );

  const topSports = await prisma.prospect.groupBy({
    by: ["primarySport"],
    where: { primarySport: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 12,
  });

  const replyRate7 = contacted7 ? replied7 / contacted7 : 0;
  const signRate7 = contacted7 ? signed7 / contacted7 : 0;
  const replyRate30 = contacted30 ? replied30 / contacted30 : 0;
  const signRate30 = contacted30 ? signed30 / contacted30 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-white/70">
            Funnel health and discovery yield.
          </p>
        </div>
        <Link
          href="/outreach-today"
          className="rounded-md bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
        >
          Outreach Today →
        </Link>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-white/60">Depositor funnel (X)</div>
            <div className="mt-1 text-xs text-white/50">
              Outbound comments â†’ inbound LINK DMs â†’ tracked clicks (7d / 30d).
            </div>
          </div>
          <Link
            href="/x"
            className="rounded-md bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            X settings â†’
          </Link>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-3 py-2 text-left">Bucket</th>
                <th className="px-3 py-2 text-right">Outbound (7d)</th>
                <th className="px-3 py-2 text-right">Outbound (30d)</th>
                <th className="px-3 py-2 text-right">LINK DMs (7d)</th>
                <th className="px-3 py-2 text-right">LINK DMs (30d)</th>
                <th className="px-3 py-2 text-right">Clicks (7d)</th>
                <th className="px-3 py-2 text-right">Clicks (30d)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {depositorFunnelRows.map((row) => {
                const outbound7 = outboundByTier7.get(row.key) ?? 0;
                const outbound30 = outboundByTier30.get(row.key) ?? 0;
                const link7 = linkRequestsByBucket7.get(row.key) ?? 0;
                const link30 = linkRequestsByBucket30.get(row.key) ?? 0;
                const clicks7 = clicks7ByBucket.get(row.key) ?? 0;
                const clicks30 = clicks30ByBucket.get(row.key) ?? 0;
                return (
                  <tr key={row.key} className="hover:bg-white/5">
                    <td className="px-3 py-2 text-white/80">{row.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{outbound7}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{outbound30}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{link7}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{link30}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{clicks7}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{clicks30}</td>
                  </tr>
                );
              })}
              <tr className="hover:bg-white/5">
                <td className="px-3 py-2 text-white/80">Untracked (no publicBaseUrl)</td>
                <td className="px-3 py-2 text-right tabular-nums">â€”</td>
                <td className="px-3 py-2 text-right tabular-nums">â€”</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {linkRequestsUntracked7}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {linkRequestsUntracked30}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">0</td>
                <td className="px-3 py-2 text-right tabular-nums">0</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-2 text-xs text-white/50">
          Outbound replies ask for <span className="font-mono">LINK PAYOUT</span>,{" "}
          <span className="font-mono">LINK PICKS</span>, or <span className="font-mono">LINK GEN</span> so you can attribute results.
          <div className="mt-1">
            Reddit-tagged DMs: <span className="tabular-nums">{redditLinkRequests7}</span> (7d) /{" "}
            <span className="tabular-nums">{redditLinkRequests30}</span> (30d) — clicks:{" "}
            <span className="tabular-nums">{redditClicks7}</span> (7d) /{" "}
            <span className="tabular-nums">{redditClicks30}</span> (30d)
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">DM templates (X) (30d)</div>
          <div className="mt-2 text-xs text-white/50">
            Auto-replies for LINK/HELP only. Clicked = tracking link had at least 1 click in window.
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-3 py-2 text-left">Template</th>
                  <th className="px-3 py-2 text-right">Sent (7d)</th>
                  <th className="px-3 py-2 text-right">Clicked (7d)</th>
                  <th className="px-3 py-2 text-right">Sent (30d)</th>
                  <th className="px-3 py-2 text-right">Clicked (30d)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {templateRows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-white/60" colSpan={5}>
                      No DM auto-replies yet.
                    </td>
                  </tr>
                ) : (
                  templateRows.slice(0, 12).map((r) => (
                    <tr key={r.key} className="hover:bg-white/5">
                      <td className="px-3 py-2 font-mono text-xs text-white/80">{r.key}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.sent7}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.clicked7}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.sent30}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.clicked30}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-white/50">
            Menu DMs sent (30d): <span className="tabular-nums">{dmMenu30.length}</span>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Follow-ups (X) (30d)</div>
          <div className="mt-2 text-xs text-white/50">
            Sent 12-36h after link if no click. Max 1 per token.
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-3 py-2 text-left">Template</th>
                  <th className="px-3 py-2 text-right">Sent (7d)</th>
                  <th className="px-3 py-2 text-right">Clicked (7d)</th>
                  <th className="px-3 py-2 text-right">Sent (30d)</th>
                  <th className="px-3 py-2 text-right">Clicked (30d)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {followUpRows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-white/60" colSpan={5}>
                      No follow-ups yet.
                    </td>
                  </tr>
                ) : (
                  followUpRows.slice(0, 12).map((r) => (
                    <tr key={r.key} className="hover:bg-white/5">
                      <td className="px-3 py-2 font-mono text-xs text-white/80">{r.key}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.sent7}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.clicked7}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.sent30}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.clicked30}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-white/60">Reddit feeder (30d)</div>
            <div className="mt-1 text-xs text-white/50">
              Logged outbound comments. CTA is only used when subreddit is marked CTA-allowed.
            </div>
          </div>
          <Link
            href="/reddit"
            className="rounded-md bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            Reddit settings â†’
          </Link>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-white/10 bg-black/40 p-3">
            <div className="text-xs text-white/60">Comments (7d)</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-white">
              {Array.from(redditByTier7.values()).reduce((a, b) => a + b, 0)}
            </div>
            <div className="mt-1 text-xs text-white/60">
              CTA: <span className="tabular-nums">{redditCta7}</span>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/40 p-3">
            <div className="text-xs text-white/60">Comments (30d)</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-white">
              {Array.from(redditByTier30.values()).reduce((a, b) => a + b, 0)}
            </div>
            <div className="mt-1 text-xs text-white/60">
              CTA: <span className="tabular-nums">{redditCta30}</span>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/40 p-3 md:col-span-2">
            <div className="text-xs text-white/60">By tier (30d)</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {Array.from(redditByTier30.entries())
                .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                .slice(0, 6)
                .map(([tier, n]) => (
                  <span
                    key={tier}
                    className="rounded-full bg-white/5 px-2 py-1 text-xs text-white/80"
                  >
                    {tier}: <span className="tabular-nums">{n}</span>
                  </span>
                ))}
              {redditOutbound30.length === 0 ? (
                <span className="text-xs text-white/50">No Reddit comments logged yet.</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="text-xs uppercase tracking-wide text-white/60">Top outbound queries (30d)</div>
        <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-3 py-2 text-left">Tier</th>
                <th className="px-3 py-2 text-left">Query</th>
                <th className="px-3 py-2 text-right">Replies</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {topOutboundQueries30.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-white/60" colSpan={3}>
                    No outbound replies yet.
                  </td>
                </tr>
              ) : (
                topOutboundQueries30.map((q, idx) => (
                  <tr key={`${q.tier}-${idx}`} className="hover:bg-white/5">
                    <td className="px-3 py-2 font-mono text-xs text-white/80">{q.tier}</td>
                    <td className="px-3 py-2 font-mono text-xs text-white/70">{q.query}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{q.count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="text-xs uppercase tracking-wide text-white/60">Manual weekly deposits</div>
        <div className="mt-2 text-xs text-white/50">
          Until provider attribution exists, log weekly deposits here by tier or by campaign.
        </div>

        <form action={upsertWeeklyDepositResultAction} className="mt-3 grid gap-3 md:grid-cols-6">
          <label className="block md:col-span-2">
            <div className="mb-1 text-xs text-white/60">Week start (ET)</div>
            <input
              name="weekStart"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
              required
            />
          </label>

          <label className="block">
            <div className="mb-1 text-xs text-white/60">Bucket</div>
            <select
              name="bucket"
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
              defaultValue="tier"
            >
              <option value="tier">Tier</option>
              <option value="campaign">Campaign</option>
            </select>
          </label>

          <label className="block md:col-span-1">
            <div className="mb-1 text-xs text-white/60">Tier (if bucket=tier)</div>
            <select
              name="tier"
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
              defaultValue="payout_reviews"
            >
              <option value="payout_reviews">payout_reviews</option>
              <option value="picks_parlays">picks_parlays</option>
              <option value="general">general</option>
              <option value="default">default</option>
            </select>
          </label>

          <label className="block md:col-span-2">
            <div className="mb-1 text-xs text-white/60">Campaign (if bucket=campaign)</div>
            <select
              name="campaignId"
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
              defaultValue=""
            >
              <option value="">â€”</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.type})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-1 text-xs text-white/60">Depositors</div>
            <input
              name="depositors"
              type="number"
              min={0}
              max={100000}
              defaultValue={0}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
              required
            />
          </label>

          <label className="block">
            <div className="mb-1 text-xs text-white/60">Deposits ($)</div>
            <input
              name="depositsUsd"
              type="number"
              min={0}
              step="0.01"
              defaultValue={0}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
              required
            />
          </label>

          <label className="block md:col-span-4">
            <div className="mb-1 text-xs text-white/60">Notes (optional)</div>
            <input
              name="notes"
              placeholder="e.g. pulled from provider dashboard"
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
            />
          </label>

          <div className="flex items-end md:col-span-2">
            <button className="w-full rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-black hover:bg-amber-300">
              Save weekly result
            </button>
          </div>
        </form>

        <div className="mt-4 overflow-hidden rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-3 py-2 text-left">Week</th>
                <th className="px-3 py-2 text-left">Tier</th>
                <th className="px-3 py-2 text-left">Campaign</th>
                <th className="px-3 py-2 text-right">Depositors</th>
                <th className="px-3 py-2 text-right">Deposits ($)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {weeklyDepositResults.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-white/60" colSpan={5}>
                    No manual weekly deposits logged yet.
                  </td>
                </tr>
              ) : (
                weeklyDepositResults.map((r) => (
                  <tr key={r.id} className="hover:bg-white/5">
                    <td className="px-3 py-2 font-mono text-xs text-white/80">
                      {new Date(r.weekStart).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-white/70">{r.tier ?? "â€”"}</td>
                    <td className="px-3 py-2 text-white/70">{r.campaign?.name ?? "â€”"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.depositors}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.depositsUsd.toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Last 7 days</div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-white/60">Contacted</dt>
              <dd className="text-lg font-semibold tabular-nums">{contacted7}</dd>
            </div>
            <div>
              <dt className="text-white/60">Replied</dt>
              <dd className="text-lg font-semibold tabular-nums">{replied7}</dd>
            </div>
            <div>
              <dt className="text-white/60">Signed</dt>
              <dd className="text-lg font-semibold tabular-nums">{signed7}</dd>
            </div>
            <div>
              <dt className="text-white/60">Reply rate</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {(replyRate7 * 100).toFixed(0)}%
              </dd>
            </div>
            <div>
              <dt className="text-white/60">Sign rate</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {(signRate7 * 100).toFixed(0)}%
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Last 30 days</div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-white/60">Contacted</dt>
              <dd className="text-lg font-semibold tabular-nums">{contacted30}</dd>
            </div>
            <div>
              <dt className="text-white/60">Replied</dt>
              <dd className="text-lg font-semibold tabular-nums">{replied30}</dd>
            </div>
            <div>
              <dt className="text-white/60">Signed</dt>
              <dd className="text-lg font-semibold tabular-nums">{signed30}</dd>
            </div>
            <div>
              <dt className="text-white/60">Reply rate</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {(replyRate30 * 100).toFixed(0)}%
              </dd>
            </div>
            <div>
              <dt className="text-white/60">Sign rate</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {(signRate30 * 100).toFixed(0)}%
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">
            Manual results (last 30 days)
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-white/60">Ambassadors w/ results</dt>
              <dd className="text-lg font-semibold tabular-nums">{weeklyResults30.length}</dd>
            </div>
            <div>
              <dt className="text-white/60">Depositors</dt>
              <dd className="text-lg font-semibold tabular-nums">{totalDepositors30}</dd>
            </div>
            <div>
              <dt className="text-white/60">Deposits ($)</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {totalDepositsUsd30.toFixed(2)}
              </dd>
            </div>
          </dl>
          <div className="mt-2 text-xs text-white/50">
            Log <span className="font-mono">weekly_results</span> events on a signed prospect to train the system.
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">
            Campaign clicks (7d / 30d)
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-3 py-2 text-left">Campaign</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">7d</th>
                  <th className="px-3 py-2 text-right">30d</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {topCampaigns.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-white/60" colSpan={4}>
                      No clicks yet. Create tracked links in Campaigns.
                    </td>
                  </tr>
                ) : (
                  topCampaigns.map((c) => (
                    <tr key={c.id} className="hover:bg-white/5">
                      <td className="px-3 py-2">
                        <Link href="/campaigns" className="font-medium">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-white/70">{c.type}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.clicks7}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.clicks30}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="text-xs uppercase tracking-wide text-white/60">
          Top ambassadors (weekly_results, 30d)
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-3 py-2 text-left">Prospect</th>
                <th className="px-3 py-2 text-left">Owner</th>
                <th className="px-3 py-2 text-right">Depositors</th>
                <th className="px-3 py-2 text-right">Deposits ($)</th>
                <th className="px-3 py-2 text-left">Last</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {weeklyResults30.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-white/60" colSpan={5}>
                    No weekly results logged yet.
                  </td>
                </tr>
              ) : (
                weeklyResults30.map((r) => {
                  const p = weeklyProspectById.get(r.prospectId);
                  return (
                    <tr key={r.prospectId} className="hover:bg-white/5">
                      <td className="px-3 py-2">
                        {p ? (
                          <Link href={`/prospects/${p.id}`} className="font-medium">
                            @{p.handle}
                          </Link>
                        ) : (
                          <span className="text-white/70">unknown</span>
                        )}
                        {p ? <div className="text-xs text-white/50">{p.status}</div> : null}
                      </td>
                      <td className="px-3 py-2 text-white/70">{p?.owner ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r._sum.depositors ?? 0}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {(r._sum.depositsUsd ?? 0).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-xs text-white/60">
                        {r._max.eventAt
                          ? new Date(r._max.eventAt).toISOString().slice(0, 10)
                          : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">
            Top discovery queries
          </div>
          <div className="mt-2 text-xs text-white/50">
            Attribution uses `firstDiscoveredQueryId` (first time we saw the account).
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
            <div className="md:hidden">
              {queryStats.length === 0 ? (
                <div className="px-4 py-6 text-sm text-white/60">
                  No discovery attribution yet.
                </div>
              ) : (
                <div className="divide-y divide-white/10">
                  {queryStats.map((q) => (
                    <div key={q.queryId} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-mono text-xs text-white/80">
                          {q.queryId}
                        </div>
                        <div className="text-xs tabular-nums text-amber-200">
                          {(q.yieldScore * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-white/70">
                        <div>
                          <div className="text-white/50">Discovered</div>
                          <div className="mt-0.5 font-medium tabular-nums text-white/90">
                            {q.discovered}
                          </div>
                        </div>
                        <div>
                          <div className="text-white/50">Queued</div>
                          <div className="mt-0.5 font-medium tabular-nums text-white/90">
                            {q.queuedEver}
                          </div>
                        </div>
                        <div>
                          <div className="text-white/50">Signed</div>
                          <div className="mt-0.5 font-medium tabular-nums text-white/90">
                            {q.signed}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-3 py-2 text-left">Query</th>
                  <th className="px-3 py-2 text-right">Discovered</th>
                  <th className="px-3 py-2 text-right">Queued</th>
                  <th className="px-3 py-2 text-right">Signed</th>
                  <th className="px-3 py-2 text-right">Yield</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {queryStats.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-white/60" colSpan={5}>
                      No discovery attribution yet.
                    </td>
                  </tr>
                ) : (
                  queryStats.map((q) => (
                    <tr key={q.queryId} className="hover:bg-white/5">
                      <td className="px-3 py-2 font-mono text-xs text-white/80">
                        {q.queryId}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {q.discovered}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {q.queuedEver}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {q.signed}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {(q.yieldScore * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">
            Primary sport mix
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
            <div className="md:hidden">
              {topSports.length === 0 ? (
                <div className="px-4 py-6 text-sm text-white/60">
                  No analyzed sports yet.
                </div>
              ) : (
                <div className="divide-y divide-white/10">
                  {topSports.map((s) => (
                    <div key={s.primarySport ?? "unknown"} className="flex items-center justify-between gap-3 p-4">
                      <div className="text-sm">{s.primarySport}</div>
                      <div className="text-sm font-medium tabular-nums text-white/90">
                        {s._count.id}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-3 py-2 text-left">Sport</th>
                  <th className="px-3 py-2 text-right">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {topSports.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-white/60" colSpan={2}>
                      No analyzed sports yet.
                    </td>
                  </tr>
                ) : (
                  topSports.map((s) => (
                    <tr key={s.primarySport ?? "unknown"} className="hover:bg-white/5">
                      <td className="px-3 py-2">{s.primarySport}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s._count.id}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
