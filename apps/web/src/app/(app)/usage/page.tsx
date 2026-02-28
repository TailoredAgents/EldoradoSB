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

      <div className="surface overflow-hidden">
        <div className="md:hidden">
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-sm text-white/60">No usage recorded yet.</div>
          ) : (
            <div className="divide-y divide-white/10">
              {rows.map((r) => (
                <div key={r.date.toISOString()} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-medium">
                      {r.date.toISOString().slice(0, 10)}
                    </div>
                    <div className="text-xs text-white/60 tabular-nums">
                      {r.estimatedCostUsd?.toFixed(2) ?? "—"}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-white/70">
                    <div>
                      <div className="text-white/50">X post reads</div>
                      <div className="mt-0.5 font-medium tabular-nums text-white/90">
                        {r.xPostReads.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-white/50">X user lookups</div>
                      <div className="mt-0.5 font-medium tabular-nums text-white/90">
                        {r.xUserLookups.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="hidden md:block">
        <table className="app-table">
          <thead className="app-thead">
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
      </div>

      <div className="surface p-4">
        <div className="text-xs uppercase tracking-wide text-white/60">Recent worker runs</div>
        <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
          <div className="md:hidden">
            {runs.length === 0 ? (
              <div className="px-4 py-6 text-sm text-white/60">No worker runs recorded yet.</div>
            ) : (
              <div className="divide-y divide-white/10">
                {runs.map((r) => (
                  <div key={r.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm font-medium text-white/90">
                        {new Date(r.startedAt).toISOString().slice(0, 19).replace("T", " ")}Z
                      </div>
                      <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-white/70">
                        {r.status}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-white/70">
                      <div>
                        <div className="text-white/50">Δ posts</div>
                        <div className="mt-0.5 font-medium tabular-nums text-white/90">
                          {r.xPostReadsDelta}
                        </div>
                      </div>
                      <div>
                        <div className="text-white/50">Δ users</div>
                        <div className="mt-0.5 font-medium tabular-nums text-white/90">
                          {r.xUserLookupsDelta}
                        </div>
                      </div>
                      <div>
                        <div className="text-white/50">Dry</div>
                        <div className="mt-0.5 font-medium text-white/90">
                          {r.dryRun ? "yes" : "no"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="hidden md:block">
          <table className="app-table">
            <thead className="app-thead">
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
    </div>
  );
}
