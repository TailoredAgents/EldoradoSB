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
        <div className="md:hidden">
          {todayProspects.length === 0 ? (
            <div className="px-4 py-6 text-sm text-white/60">
              No queued prospects yet. Queue some from the New tab.
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {todayProspects.map((p) => (
                <div key={p.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={`/prospects/${p.id}`} className="text-base font-medium">
                        @{p.handle}
                      </Link>
                      {p.name ? (
                        <div className="text-xs text-white/60">{p.name}</div>
                      ) : null}
                    </div>
                    <span className="rounded-md bg-amber-400/10 px-2 py-1 text-xs text-amber-200">
                      {p.tier ?? "—"}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-white/70">
                    <div>
                      <div className="text-white/50">Overall</div>
                      <div className="mt-0.5 font-medium tabular-nums text-white/90">
                        {p.overallScore?.toFixed(0) ?? "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-white/50">Followers</div>
                      <div className="mt-0.5 font-medium tabular-nums text-white/90">
                        {p.followers?.toLocaleString() ?? "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-white/50">Owner</div>
                      <div className="mt-0.5 font-medium text-white/90">{p.owner ?? "—"}</div>
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
      </div>

      {backlogProspects.length ? (
        <div className="space-y-2">
          <div className="text-sm text-white/70">Queued backlog</div>
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
            <div className="md:hidden divide-y divide-white/10">
              {backlogProspects.map((p) => (
                <div key={p.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/prospects/${p.id}`} className="font-medium">
                      @{p.handle}
                    </Link>
                    <div className="text-xs text-white/70 tabular-nums">
                      {p.overallScore?.toFixed(0) ?? "—"}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-white/60">
                    queued: {p.queuedAt ? new Date(p.queuedAt).toISOString().slice(0, 10) : "—"}
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block">
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
        </div>
      ) : null}
    </div>
  );
}
