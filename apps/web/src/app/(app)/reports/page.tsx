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
            Top discovery queries
          </div>
          <div className="mt-2 text-xs text-white/50">
            Attribution uses `firstDiscoveredQueryId` (first time we saw the account).
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
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

        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">
            Primary sport mix
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
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
  );
}
