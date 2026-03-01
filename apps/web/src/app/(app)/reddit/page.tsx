import { prisma } from "@el-dorado/db";
import { getAppTimeZone, startOfDayApp, startOfNextDayApp } from "@/lib/time";
import { clearRedditBackoffAction, updateRedditSettingsAction } from "./serverActions";

export const dynamic = "force-dynamic";

function readConfig(config: unknown): { xHandle: string; subreddits: Array<{ name: string; allowCta: boolean }> } {
  const fallback = { xHandle: "EldoradoSB", subreddits: [] as Array<{ name: string; allowCta: boolean }> };
  if (!config || typeof config !== "object") return fallback;
  const raw = config as { xHandle?: unknown; subreddits?: unknown };
  const xHandle = raw.xHandle ? String(raw.xHandle).trim() : "EldoradoSB";
  const subreddits = Array.isArray(raw.subreddits)
    ? raw.subreddits
        .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : null))
        .map((s) => {
          const name = s && typeof s.name === "string" ? s.name.trim() : "";
          const allowCta = Boolean(s?.allowCta);
          if (!name) return null;
          return { name, allowCta };
        })
        .filter((x): x is { name: string; allowCta: boolean } => Boolean(x))
    : [];
  return { xHandle: xHandle || "EldoradoSB", subreddits };
}

function isObj(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object";
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export default async function RedditPage({
  searchParams,
}: {
  searchParams: { ok?: string; error?: string };
}) {
  const { ok, error } = searchParams;

  const settings =
    (await prisma.redditAccountSettings.findUnique({ where: { id: 1 } })) ??
    (await prisma.redditAccountSettings.create({ data: { id: 1 } }));

  const cfg = readConfig(settings.config);
  const subsText = cfg.subreddits.map((s) => s.name).join("\n");
  const ctaAllowedText = cfg.subreddits.filter((s) => s.allowCta).map((s) => s.name).join("\n");

  const tz = getAppTimeZone();
  const now = new Date();
  const dayStart = startOfDayApp(now, tz);
  const dayEnd = startOfNextDayApp(now, tz);
  const since24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const sentToday = await prisma.conversationMessage.count({
    where: { platform: "reddit", direction: "outbound", createdAt: { gte: dayStart, lt: dayEnd } },
  });

  const errors24h = await prisma.handledItem.count({
    where: { platform: "reddit", status: "error", updatedAt: { gte: since24 } },
  });

  const outbound7 = await prisma.conversationMessage.findMany({
    where: { platform: "reddit", direction: "outbound", createdAt: { gte: since7 } },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: { meta: true },
  });
  const removedRows = outbound7
    .map((r) => (isObj(r.meta) ? (r.meta as Record<string, unknown>) : null))
    .filter(Boolean)
    .filter((m) => Boolean((m as Record<string, unknown>).removed)) as Array<Record<string, unknown>>;
  const removed7d = removedRows.length;
  const removedAtDates = removedRows.map((m) => parseIsoDate(m.removedAt)).filter((d): d is Date => Boolean(d));
  const removed24h = removedAtDates.filter((d) => d >= since24).length;

  const isBackoff = Boolean(settings.backoffUntil && settings.backoffUntil > now);

  const recent = await prisma.conversationMessage.findMany({
    where: { platform: "reddit", direction: "outbound" },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { createdAt: true, text: true, meta: true },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reddit</h1>
        <p className="mt-1 text-sm text-white/70">
          Low-volume, value-first Reddit feeder. Only use CTA in allowlisted subs.
        </p>
      </div>

      {ok ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          Saved.
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          Error saving settings.
        </div>
      ) : null}

      <div className="surface p-4">
        <div className="text-xs uppercase tracking-wide text-white/60">Today</div>
        <div className="mt-2 text-sm text-white/80">
          Comments sent today (ET): <span className="font-semibold text-white">{sentToday}</span>
        </div>
        <div className="mt-2 text-sm text-white/80">
          Health (24h):{" "}
          <span className="tabular-nums">{errors24h}</span> errors,{" "}
          <span className="tabular-nums">{removed24h}</span> removals
          {removed7d > 0 ? (
            <span className="text-white/60"> (removed 7d: {removed7d})</span>
          ) : null}
        </div>
        {isBackoff ? (
          <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Outbound paused until <span className="font-mono">{settings.backoffUntil?.toISOString()}</span> (UTC).
            <form action={clearRedditBackoffAction} className="mt-2">
              <button className="btn btn-secondary px-3">Clear pause</button>
            </form>
          </div>
        ) : null}
        <div className="mt-2 text-xs text-white/50">
          Removal detection updates when the worker runs and audits recent comments.
        </div>
      </div>

      <form action={updateRedditSettingsAction} className="space-y-4">
        <div className="surface p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Enabled</div>
          <label className="mt-3 flex items-center gap-3 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="h-4 w-4 accent-amber-400" />
            <span>Enable Reddit module</span>
          </label>
          <label className="mt-3 flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="outboundEnabled"
              defaultChecked={settings.outboundEnabled}
              className="h-4 w-4 accent-amber-400"
            />
            <span>Enable outbound commenting</span>
          </label>
          <label className="mt-3 flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="inboundEnabled"
              defaultChecked={settings.inboundEnabled}
              className="h-4 w-4 accent-amber-400"
            />
            <span>Enable inbound message capture</span>
          </label>
          <div className="mt-3 text-xs text-white/50">
            Requires env vars: <span className="font-mono">REDDIT_CLIENT_ID</span>,{" "}
            <span className="font-mono">REDDIT_CLIENT_SECRET</span>,{" "}
            <span className="font-mono">REDDIT_USERNAME</span>,{" "}
            <span className="font-mono">REDDIT_PASSWORD</span>.
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="surface p-4">
            <div className="text-xs uppercase tracking-wide text-white/60">Caps</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <div className="mb-1 text-xs text-white/60">Max comments/day</div>
                <input
                  name="maxCommentsPerDay"
                  type="number"
                  min={0}
                  max={200}
                  defaultValue={settings.maxCommentsPerDay}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs text-white/60">Max comments/run</div>
                <input
                  name="maxCommentsPerRun"
                  type="number"
                  min={0}
                  max={50}
                  defaultValue={settings.maxCommentsPerRun}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                />
              </label>
            </div>
            <label className="mt-3 block">
              <div className="mb-1 text-xs text-white/60">CTA percent (allowlisted subs only)</div>
              <input
                name="ctaPercent"
                type="number"
                min={0}
                max={100}
                defaultValue={settings.ctaPercent}
                className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
              />
            </label>
            <div className="mt-4 border-t border-white/10 pt-4">
              <div className="text-xs uppercase tracking-wide text-white/60">Guardrails</div>
              <label className="mt-3 flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="autoBackoffEnabled"
                  defaultChecked={settings.autoBackoffEnabled}
                  className="h-4 w-4 accent-amber-400"
                />
                <span>Auto-pause outbound on removals/errors</span>
              </label>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="mb-1 text-xs text-white/60">Max errors/24h</div>
                  <input
                    name="maxErrorsPerDay"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={settings.maxErrorsPerDay}
                    className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-xs text-white/60">Max removals/24h</div>
                  <input
                    name="maxRemovalsPerDay"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={settings.maxRemovalsPerDay}
                    className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                  />
                </label>
              </div>
              <div className="mt-2 text-xs text-white/50">
                If the worker sees too many removals/errors in a 24h window, it pauses outbound until tomorrow.
              </div>
            </div>
          </div>

          <div className="surface p-4">
            <div className="text-xs uppercase tracking-wide text-white/60">CTA Target</div>
            <label className="mt-3 block">
              <div className="mb-1 text-xs text-white/60">X handle to DM</div>
              <input
                name="xHandle"
                defaultValue={cfg.xHandle}
                className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                placeholder="EldoradoSB"
              />
            </label>
            <div className="mt-2 text-xs text-white/50">
              CTA text uses: DM @{cfg.xHandle} on X with LINK PAYOUT/PICKS/GEN + REDDIT.
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="surface p-4">
            <div className="text-xs uppercase tracking-wide text-white/60">Subreddits (allowlist)</div>
            <textarea
              name="subreddits"
              defaultValue={subsText}
              rows={10}
              placeholder={"sportsbook\nsportsbetting\nnfl\nnba"}
              className="mt-3 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
            />
            <div className="mt-2 text-xs text-white/50">One subreddit per line. Comments only run in this list.</div>
          </div>

          <div className="surface p-4">
            <div className="text-xs uppercase tracking-wide text-white/60">CTA allowed subreddits</div>
            <textarea
              name="ctaAllowedSubreddits"
              defaultValue={ctaAllowedText}
              rows={10}
              placeholder={"sportsbook"}
              className="mt-3 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
            />
            <div className="mt-2 text-xs text-white/50">
              Only subs listed here are allowed to receive CTA comments. Everything else stays value-only.
            </div>
          </div>
        </div>

        <button className="btn btn-primary px-4">
          Save Reddit settings
        </button>
      </form>

      <div className="surface p-4">
        <div className="text-xs uppercase tracking-wide text-white/60">Recent Reddit comments (logged)</div>
        <div className="mt-3 space-y-2">
          {recent.length === 0 ? (
            <div className="text-sm text-white/60">No comments logged yet.</div>
          ) : (
            recent.map((r, idx) => (
              <div key={idx} className="rounded-lg border border-white/10 bg-black/40 p-3 text-sm text-white/90">
                <div className="mb-1 text-xs text-white/60">
                  {r.createdAt.toISOString().slice(0, 19).replace("T", " ")}Z
                </div>
                <div className="whitespace-pre-wrap">{r.text}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
