import { prisma } from "@el-dorado/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

function daysAgoUtc(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export default async function ReportsPage() {
  const since7 = daysAgoUtc(7);
  const since30 = daysAgoUtc(30);

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
