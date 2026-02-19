import { prisma } from "@el-dorado/db";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const rows = await prisma.usageLedger.findMany({
    orderBy: { date: "desc" },
    take: 30,
  });

  const runs = await prisma.workerRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="mt-1 text-sm text-white/70">
          Daily counters for X and LLM usage.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
            <tr>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-right">X post reads</th>
              <th className="px-4 py-3 text-right">X user lookups</th>
              <th className="px-4 py-3 text-right">Est. cost ($)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-white/60" colSpan={4}>
                  No usage recorded yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.date.toISOString()} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    {r.date.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.xPostReads.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.xUserLookups.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.estimatedCostUsd?.toFixed(2) ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="text-xs uppercase tracking-wide text-white/60">Recent worker runs</div>
        <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-3 py-2 text-left">Started</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Δ posts</th>
                <th className="px-3 py-2 text-right">Δ users</th>
                <th className="px-3 py-2 text-left">Dry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {runs.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-white/60" colSpan={5}>
                    No worker runs recorded yet.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} className="hover:bg-white/5">
                    <td className="px-3 py-2 text-white/80">
                      {new Date(r.startedAt).toISOString().slice(0, 19).replace("T", " ")}Z
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-white/70">
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.xPostReadsDelta}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.xUserLookupsDelta}</td>
                    <td className="px-3 py-2 text-white/70">{r.dryRun ? "yes" : "no"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

