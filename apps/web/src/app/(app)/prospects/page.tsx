import Link from "next/link";
import { prisma } from "@el-dorado/db";
import { ProspectStatus } from "@el-dorado/db";
import { updateProspectStatusAction, updateProspectOwnerAction } from "./serverActions";

export const dynamic = "force-dynamic";

type Bucket = "new" | "in-progress" | "done";

function bucketToStatuses(bucket: Bucket): ProspectStatus[] {
  if (bucket === "new") return [ProspectStatus.new];
  if (bucket === "in-progress")
    return [ProspectStatus.contacted, ProspectStatus.replied, ProspectStatus.negotiating];
  return [
    ProspectStatus.done,
    ProspectStatus.signed,
    ProspectStatus.rejected,
    ProspectStatus.dnc,
  ];
}

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: { bucket?: string; q?: string };
}) {
  const { bucket: bucketRaw, q } = searchParams;
  const bucket = (bucketRaw as Bucket) ?? "new";
  const statuses = bucketToStatuses(bucket);

  const prospects = await prisma.prospect.findMany({
    where: {
      status: { in: statuses },
      ...(q
        ? {
            OR: [
              { handle: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ overallScore: "desc" }, { updatedAt: "desc" }],
    take: 250,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Prospects</h1>
          <p className="mt-1 text-sm text-white/70">
            Bucket: <span className="text-amber-200">{bucket}</span>
          </p>
        </div>

        <form className="flex items-center gap-2" action="/prospects" method="get">
          <input type="hidden" name="bucket" value={bucket} />
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search handle/name…"
            className="w-56 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
          />
          <button className="rounded-lg bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10">
            Search
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {(["new", "in-progress", "done"] as Bucket[]).map((b) => (
          <Link
            key={b}
            href={`/prospects?bucket=${b}`}
            className={`rounded-md px-3 py-1.5 ${
              b === bucket ? "bg-amber-400/15 text-amber-200" : "bg-white/5 text-white/80 hover:bg-white/10"
            }`}
          >
            {b}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
            <tr>
              <th className="px-4 py-3 text-left">Account</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Owner</th>
              <th className="px-4 py-3 text-right">Overall</th>
              <th className="px-4 py-3 text-right">Followers</th>
              <th className="px-4 py-3 text-left">Quick</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {prospects.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-white/60" colSpan={6}>
                  No prospects in this bucket yet.
                </td>
              </tr>
            ) : (
              prospects.map((p) => (
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
                    <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-white/70">
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <form action={updateProspectOwnerAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={p.id} />
                      <input
                        name="owner"
                        defaultValue={p.owner ?? ""}
                        placeholder="Devon"
                        className="w-28 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                      />
                      <button className="rounded-md bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10">
                        Save
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {p.overallScore?.toFixed(0) ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {p.followers?.toLocaleString() ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <form action={updateProspectStatusAction} className="flex gap-2">
                      <input type="hidden" name="id" value={p.id} />
                      <select
                        name="status"
                        defaultValue={p.status}
                        className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-amber-400/50"
                      >
                        {Object.values(ProspectStatus).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <button className="rounded-md bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10">
                        Update
                      </button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
