import { prisma } from "@el-dorado/db";
import {
  startXOAuthAction,
  disconnectXAction,
  updateXAccountSettingsAction,
} from "./serverActions";

export const dynamic = "force-dynamic";

function readSchedulePosts(schedule: unknown): string[] {
  if (!schedule || typeof schedule !== "object") return [];
  const posts = (schedule as { posts?: unknown }).posts;
  if (!Array.isArray(posts)) return [];
  return posts
    .map((x) => String(x ?? "").trim())
    .filter((x) => /^\d{2}:\d{2}$/.test(x))
    .slice(0, 6);
}

export default async function XPage({
  searchParams,
}: {
  searchParams: { ok?: string; error?: string };
}) {
  const { ok, error } = searchParams;

  const cred = await prisma.xCredential.findUnique({
    where: { id: 1 },
    select: { scope: true, tokenType: true, expiresAt: true, updatedAt: true },
  });

  const settings = await prisma.xAccountSettings.findUnique({
    where: { id: 1 },
  });

  const actions = await prisma.xActionLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  const isConnected = Boolean(cred);

  const schedulePosts = readSchedulePosts(settings?.schedule ?? null);
  const postTime1 = schedulePosts[0] ?? "10:00";
  const postTime2 = schedulePosts[1] ?? "12:30";
  const postTime3 = schedulePosts[2] ?? "15:30";
  const postTime4 = schedulePosts[3] ?? "18:30";
  const postTime5 = schedulePosts[4] ?? "21:00";
  const postTime6 = schedulePosts[5] ?? "23:30";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Eldorado X</h1>
        <p className="mt-1 text-sm text-white/70">
          Connect the Eldorado X account (OAuth) and view recent actions.
        </p>
      </div>

      {ok ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {ok === "disconnected" ? "Disconnected." : "Saved."}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          Error connecting to X. Check env vars and logs.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="surface p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Connection</div>
          <div className="mt-3 text-sm text-white/80">
            Status:{" "}
            {isConnected ? (
              <span className="text-emerald-200">connected</span>
            ) : (
              <span className="text-white/60">not connected</span>
            )}
          </div>
          {cred ? (
            <dl className="mt-3 space-y-1 text-xs text-white/60">
              <div className="flex justify-between gap-4">
                <dt>Token type</dt>
                <dd className="text-right text-white/80">{cred.tokenType ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Scope</dt>
                <dd className="text-right text-white/80">{cred.scope ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Expires</dt>
                <dd className="text-right text-white/80">
                  {cred.expiresAt ? new Date(cred.expiresAt).toISOString().slice(0, 19).replace("T", " ") + "Z" : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Updated</dt>
                <dd className="text-right text-white/80">
                  {new Date(cred.updatedAt).toISOString().slice(0, 19).replace("T", " ") + "Z"}
                </dd>
              </div>
            </dl>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {!isConnected ? (
              <form action={startXOAuthAction}>
                <button className="btn btn-primary px-4">
                  Connect X account
                </button>
              </form>
            ) : (
              <form action={disconnectXAction}>
                <button className="btn btn-secondary px-4">
                  Disconnect
                </button>
              </form>
            )}
          </div>

          <div className="mt-4 text-xs text-white/50">
            Requires env vars: <span className="font-mono">X_OAUTH_CLIENT_ID</span>,{" "}
            <span className="font-mono">X_OAUTH_REDIRECT_URI</span>,{" "}
            <span className="font-mono">X_CREDENTIALS_SECRET</span>.
          </div>
        </div>

        <div className="surface p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Agent settings</div>
          <div className="mt-3 text-sm text-white/80">
            {!settings ? (
              <div className="text-white/60">Settings row will be created after connecting.</div>
            ) : (
              <form action={updateXAccountSettingsAction} className="space-y-4">
                <div className="space-y-2 rounded-lg border border-white/10 bg-black/40 p-3">
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={settings.enabled}
                      className="h-4 w-4 accent-amber-400"
                    />
                    <span>Enabled</span>
                  </label>
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      name="autoPostEnabled"
                      defaultChecked={settings.autoPostEnabled}
                      className="h-4 w-4 accent-amber-400"
                    />
                    <span>Auto-post (up to 6/day)</span>
                  </label>
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      name="autoReplyEnabled"
                      defaultChecked={settings.autoReplyEnabled}
                      className="h-4 w-4 accent-amber-400"
                    />
                    <span>Auto-reply (Phase 4)</span>
                  </label>
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      name="outboundEnabled"
                      defaultChecked={settings.outboundEnabled}
                      className="h-4 w-4 accent-amber-400"
                    />
                    <span>Outbound engagement (Phase 5)</span>
                  </label>
                </div>

                <div className="grid gap-3 rounded-lg border border-white/10 bg-black/40 p-3 md:grid-cols-4">
                  <label className="block">
                    <div className="mb-1 text-xs text-white/60">Max posts/day</div>
                    <input
                      name="maxPostsPerDay"
                      type="number"
                      min={0}
                      max={20}
                      defaultValue={settings.maxPostsPerDay}
                      className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-xs text-white/60">Max auto replies/day</div>
                    <input
                      name="maxAutoRepliesPerDay"
                      type="number"
                      min={0}
                      max={500}
                      defaultValue={settings.maxAutoRepliesPerDay}
                      className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-xs text-white/60">Max outbound/day</div>
                    <input
                      name="maxOutboundRepliesPerDay"
                      type="number"
                      min={0}
                      max={200}
                      defaultValue={settings.maxOutboundRepliesPerDay}
                      className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-xs text-white/60">Max outbound/run</div>
                    <input
                      name="maxOutboundRepliesPerRun"
                      type="number"
                      min={0}
                      max={50}
                      defaultValue={settings.maxOutboundRepliesPerRun ?? 10}
                      className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                    />
                  </label>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-white/60">Usage guardrail (optional)</div>
                  <div className="mt-2 text-xs text-white/50">
                    Caps X pay-per-use <span className="font-mono">posts consumed</span> per <span className="font-mono">UTC day</span>{" "}
                    (uses <span className="font-mono">/2/usage/tweets</span>). Leave blank to disable.
                  </div>
                  <label className="mt-3 block">
                    <div className="mb-1 text-xs text-white/60">Max posts consumed/day (UTC)</div>
                    <input
                      name="maxPostsConsumedPerUtcDay"
                      type="number"
                      min={0}
                      max={500000}
                      defaultValue={settings.maxPostsConsumedPerUtcDay ?? ""}
                      placeholder="e.g. 3000"
                      className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                    />
                  </label>
                </div>

                <div className="grid gap-3 rounded-lg border border-white/10 bg-black/40 p-3 md:grid-cols-3">
                  <label className="block">
                    <div className="mb-1 text-xs text-white/60">Post time 1 (ET)</div>
                    <input
                      name="postTime1"
                      defaultValue={postTime1}
                      className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                      placeholder="11:00"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-xs text-white/60">Post time 2 (ET)</div>
                    <input
                      name="postTime2"
                      defaultValue={postTime2}
                      className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                      placeholder="16:00"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-xs text-white/60">Post time 3 (ET)</div>
                    <input
                      name="postTime3"
                      defaultValue={postTime3}
                      className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                      placeholder="21:30"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-xs text-white/60">Post time 4 (ET)</div>
                    <input
                      name="postTime4"
                      defaultValue={postTime4}
                      className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                      placeholder="18:30"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-xs text-white/60">Post time 5 (ET)</div>
                    <input
                      name="postTime5"
                      defaultValue={postTime5}
                      className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                      placeholder="21:00"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-xs text-white/60">Post time 6 (ET)</div>
                    <input
                      name="postTime6"
                      defaultValue={postTime6}
                      className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                      placeholder="23:30"
                    />
                  </label>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-white/60">Public base URL</div>
                  <div className="mt-2 text-xs text-white/50">
                    Used to generate tracked links (e.g., <span className="font-mono">https://your-web.onrender.com</span>).
                  </div>
                  <input
                    name="publicBaseUrl"
                    defaultValue={settings.publicBaseUrl ?? ""}
                    placeholder="https://your-web.onrender.com"
                    className="mt-3 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                  />
                </div>

                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-white/60">Tracked LINK tokens (optional)</div>
                  <div className="mt-2 text-xs text-white/50">
                    Used to attribute inbound DM <span className="font-mono">LINK</span> requests and clicks by tier. Leave blank to let the worker auto-create.
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <div className="mb-1 text-xs text-white/60">Default token</div>
                      <input
                        name="linkTokenDefault"
                        defaultValue={settings.linkTokenDefault ?? ""}
                        placeholder="auto"
                        className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                      />
                    </label>
                    <label className="block">
                      <div className="mb-1 text-xs text-white/60">PAYOUT token</div>
                      <input
                        name="linkTokenPayout"
                        defaultValue={settings.linkTokenPayout ?? ""}
                        placeholder="auto"
                        className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                      />
                    </label>
                    <label className="block">
                      <div className="mb-1 text-xs text-white/60">PICKS token</div>
                      <input
                        name="linkTokenPicks"
                        defaultValue={settings.linkTokenPicks ?? ""}
                        placeholder="auto"
                        className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                      />
                    </label>
                    <label className="block">
                      <div className="mb-1 text-xs text-white/60">GEN token</div>
                      <input
                        name="linkTokenGen"
                        defaultValue={settings.linkTokenGen ?? ""}
                        placeholder="auto"
                        className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-white/60">Disclaimer</div>
                  <textarea
                    name="disclaimerText"
                    defaultValue={settings.disclaimerText ?? ""}
                    rows={3}
                    placeholder="21+ | Terms apply | Gamble responsibly"
                    className="mt-3 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                  />
                </div>

                <button className="btn btn-primary px-4">
                  Save
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <div className="surface p-4">
        <div className="text-xs uppercase tracking-wide text-white/60">Recent X actions</div>
        {actions.length === 0 ? (
          <div className="mt-3 text-sm text-white/60">No actions yet.</div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
            <table className="app-table">
              <thead className="app-thead">
                <tr>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {actions.map((a) => (
                  <tr key={a.id} className="hover:bg-white/5">
                    <td className="px-3 py-2 text-xs text-white/70">
                      {new Date(a.createdAt).toISOString().slice(0, 19).replace("T", " ")}Z
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-white/80">{a.actionType}</td>
                    <td className="px-3 py-2 text-xs text-white/80">{a.status}</td>
                    <td className="px-3 py-2 text-xs text-white/70">{a.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
