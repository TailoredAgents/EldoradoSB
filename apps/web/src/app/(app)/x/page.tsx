import { prisma } from "@el-dorado/db";
import { startXOAuthAction, disconnectXAction } from "./serverActions";

export const dynamic = "force-dynamic";

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
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
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
                <button className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-black hover:bg-amber-300">
                  Connect X account
                </button>
              </form>
            ) : (
              <form action={disconnectXAction}>
                <button className="rounded-lg bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">
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

        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Agent settings</div>
          <div className="mt-3 text-sm text-white/80">
            {settings ? (
              <div className="space-y-1 text-sm">
                <div>
                  enabled: <span className="text-white/70">{String(settings.enabled)}</span>
                </div>
                <div>
                  autoPost:{" "}
                  <span className="text-white/70">{String(settings.autoPostEnabled)}</span>
                </div>
                <div>
                  autoReply:{" "}
                  <span className="text-white/70">{String(settings.autoReplyEnabled)}</span>
                </div>
                <div>
                  outbound:{" "}
                  <span className="text-white/70">{String(settings.outboundEnabled)}</span>
                </div>
              </div>
            ) : (
              <div className="text-white/60">
                Settings row will be created after connecting.
              </div>
            )}
          </div>
          <div className="mt-4 text-xs text-white/50">
            Full controls (toggles/caps/schedule) come in the next phase; this page
            confirms OAuth + logs.
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="text-xs uppercase tracking-wide text-white/60">Recent X actions</div>
        {actions.length === 0 ? (
          <div className="mt-3 text-sm text-white/60">No actions yet.</div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
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

