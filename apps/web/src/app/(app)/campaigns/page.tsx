import { headers } from "next/headers";
import { prisma, CampaignType } from "@el-dorado/db";
import { CopyButton } from "@/components/CopyButton";
import { createCampaignAction, createTrackingLinkAction } from "./serverActions";

export const dynamic = "force-dynamic";

function daysAgoUtc(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: { ok?: string; error?: string };
}) {
  const { ok, error } = searchParams;
  const baseUrl = await getBaseUrl();

  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      trackingLinks: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  const allLinkIds = campaigns.flatMap((c) => c.trackingLinks.map((l) => l.id));
  const since7 = daysAgoUtc(7);

  const [totalCounts, weekCounts] = await Promise.all([
    allLinkIds.length
      ? prisma.clickEvent.groupBy({
          by: ["trackingLinkId"],
          where: { trackingLinkId: { in: allLinkIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    allLinkIds.length
      ? prisma.clickEvent.groupBy({
          by: ["trackingLinkId"],
          where: { trackingLinkId: { in: allLinkIds }, createdAt: { gte: since7 } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const totalByLink = new Map(totalCounts.map((r) => [r.trackingLinkId, r._count._all]));
  const weekByLink = new Map(weekCounts.map((r) => [r.trackingLinkId, r._count._all]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="mt-1 text-sm text-white/70">
          Tracked links for campaigns and ambassadors (clicks only).
        </p>
      </div>

      {ok ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          Saved.
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          Error saving.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">New campaign</div>
          <form action={createCampaignAction} className="mt-3 space-y-3">
            <label className="block">
              <div className="mb-1 text-xs text-white/60">Name</div>
              <input
                name="name"
                placeholder="e.g., Feb promo push"
                className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                required
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs text-white/60">Type</div>
              <select
                name="type"
                defaultValue={CampaignType.mixed}
                className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
              >
                {Object.values(CampaignType).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <button className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-black hover:bg-amber-300">
              Create campaign
            </button>
          </form>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Notes</div>
          <div className="mt-3 space-y-2 text-sm text-white/70">
            <div>
              Use <span className="font-mono text-xs text-white/80">{baseUrl}/r/&lt;token&gt;</span>{" "}
              anywhere (posts, replies, DMs).
            </div>
            <div>These metrics are click-only until the provider supports attribution.</div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {campaigns.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-6 text-sm text-white/60">
            No campaigns yet.
          </div>
        ) : (
          campaigns.map((c) => (
            <div key={c.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-white/90">{c.name}</div>
                  <div className="mt-1 text-xs text-white/60">
                    type: <span className="text-white/80">{c.type}</span> · created:{" "}
                    {new Date(c.createdAt).toISOString().slice(0, 10)}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-white/60">
                    Create tracking link
                  </div>
                  <form action={createTrackingLinkAction} className="mt-3 space-y-3">
                    <input type="hidden" name="campaignId" value={c.id} />
                    <label className="block">
                      <div className="mb-1 text-xs text-white/60">Label (optional)</div>
                      <input
                        name="label"
                        placeholder="e.g., post #1 promo"
                        className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                      />
                    </label>
                    <label className="block">
                      <div className="mb-1 text-xs text-white/60">Destination URL</div>
                      <input
                        name="destinationUrl"
                        defaultValue="https://eldoradosb.com/"
                        className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                        required
                      />
                    </label>
                    <button className="rounded-lg bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">
                      Create link
                    </button>
                  </form>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-white/60">
                    Links (latest 50)
                  </div>
                  {c.trackingLinks.length === 0 ? (
                    <div className="mt-3 text-sm text-white/60">No links yet.</div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {c.trackingLinks.map((l) => {
                        const url = `${baseUrl}/r/${l.token}`;
                        const total = totalByLink.get(l.id) ?? 0;
                        const week = weekByLink.get(l.id) ?? 0;
                        return (
                          <div
                            key={l.id}
                            className="rounded-md border border-white/10 bg-black/30 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate font-mono text-xs text-white/90">
                                  {url}
                                </div>
                                <div className="mt-1 text-xs text-white/60">
                                  {l.label ? (
                                    <span className="text-white/70">{l.label}</span>
                                  ) : (
                                    <span className="text-white/40">no label</span>
                                  )}{" "}
                                  · clicks 7d:{" "}
                                  <span className="text-white/80 tabular-nums">{week}</span>{" "}
                                  · all-time:{" "}
                                  <span className="text-white/80 tabular-nums">{total}</span>
                                </div>
                              </div>
                              <CopyButton text={url} label="Copy" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

