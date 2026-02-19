import Link from "next/link";
import { prisma } from "@el-dorado/db";
import { ProspectStatus } from "@el-dorado/db";
import { startOfDayUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function OutreachTodayPage() {
  const today = startOfDayUtc(new Date());
  const todayProspects = await prisma.prospect.findMany({
    where: { status: ProspectStatus.queued, queuedDay: today },
    orderBy: [{ overallScore: "desc" }, { updatedAt: "desc" }],
    take: 20,
  });

  const backlogProspects = await prisma.prospect.findMany({
    where: { status: ProspectStatus.queued, NOT: { queuedDay: today } },
    orderBy: [{ queuedAt: "asc" }, { overallScore: "desc" }],
    take: 50,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outreach Today</h1>
          <p className="mt-1 text-sm text-white/70">
            Top queued prospects (up to 20).
          </p>
        </div>
        <Link
          href="/prospects?bucket=new"
          className="rounded-md bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
        >
          Browse New →
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
            <tr>
              <th className="px-4 py-3 text-left">Account</th>
              <th className="px-4 py-3 text-left">Tier</th>
              <th className="px-4 py-3 text-right">Overall</th>
              <th className="px-4 py-3 text-right">Followers</th>
              <th className="px-4 py-3 text-left">Owner</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {todayProspects.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-white/60" colSpan={5}>
                  No queued prospects yet. Queue some from the New tab.
                </td>
              </tr>
            ) : (
              todayProspects.map((p) => (
                <tr key={p.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <Link href={`/prospects/${p.id}`} className="font-medium">
                      @{p.handle}
                    </Link>
                    {p.name ? (
                      <div className="text-xs text-white/60">{p.name}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-md bg-amber-400/10 px-2 py-1 text-xs text-amber-200">
                      {p.tier ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {p.overallScore?.toFixed(0) ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {p.followers?.toLocaleString() ?? "—"}
                  </td>
                  <td className="px-4 py-3">{p.owner ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {backlogProspects.length ? (
        <div className="space-y-2">
          <div className="text-sm text-white/70">Queued backlog</div>
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-4 py-3 text-left">Account</th>
                  <th className="px-4 py-3 text-right">Overall</th>
                  <th className="px-4 py-3 text-left">Queued</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {backlogProspects.map((p) => (
                  <tr key={p.id} className="hover:bg-white/5">
                    <td className="px-4 py-3">
                      <Link href={`/prospects/${p.id}`} className="font-medium">
                        @{p.handle}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {p.overallScore?.toFixed(0) ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-white/70">
                      {p.queuedAt ? new Date(p.queuedAt).toISOString().slice(0, 10) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
