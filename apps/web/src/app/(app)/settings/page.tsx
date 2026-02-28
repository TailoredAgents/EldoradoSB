import { prisma } from "@el-dorado/db";
import { updateSettingsAction } from "./serverActions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { ok?: string; error?: string };
}) {
  const { ok, error } = searchParams;

  const settings =
    (await prisma.settings.findUnique({ where: { id: 1 } })) ??
    (await prisma.settings.create({ data: { id: 1 } }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-white/70">
          Kill switch, caps, and queue policy knobs.
        </p>
      </div>

      {ok ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          Saved.
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error === "1" ? "Invalid input." : "Error saving settings."}
        </div>
      ) : null}

      <form action={updateSettingsAction} className="space-y-4">
        <div className="surface p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Agent</div>
          <label className="mt-3 flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={settings.enabled}
              className="h-4 w-4 accent-amber-400"
            />
            <span>
              Enabled (turn off to pause the worker immediately)
            </span>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="surface p-4">
            <div className="text-xs uppercase tracking-wide text-white/60">Budgets</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <div className="mb-1 text-xs text-white/60">Max post reads / run</div>
                <input
                  name="maxPostReadsPerRun"
                  type="number"
                  min={1}
                  defaultValue={settings.maxPostReadsPerRun}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs text-white/60">Max post reads / day</div>
                <input
                  name="maxPostReadsPerDay"
                  type="number"
                  min={1}
                  defaultValue={settings.maxPostReadsPerDay}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                />
              </label>
            </div>

            <div className="mt-4 surface-sm p-3">
              <div className="text-xs uppercase tracking-wide text-white/60">Prospect pipeline (optional)</div>
              <div className="mt-2 text-xs text-white/50">
                Legacy ambassador discovery/scoring/draft pipeline. Keep this off when focusing on depositor outreach.
              </div>
              <label className="mt-3 flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="prospectPipelineEnabled"
                  defaultChecked={settings.prospectPipelineEnabled}
                  className="h-4 w-4 accent-amber-400"
                />
                <span>Enable prospect pipeline</span>
              </label>
              <label className="mt-3 block">
                <div className="mb-1 text-xs text-white/60">Max prospect reads / run</div>
                <input
                  name="maxProspectPipelinePostReadsPerRun"
                  type="number"
                  min={0}
                  max={200}
                  defaultValue={settings.maxProspectPipelinePostReadsPerRun}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                />
              </label>
            </div>
          </div>

          <div className="surface p-4">
            <div className="text-xs uppercase tracking-wide text-white/60">Queue mix</div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <label className="block">
                <div className="mb-1 text-xs text-white/60">Value</div>
                <input
                  name="queueValueCount"
                  type="number"
                  min={0}
                  defaultValue={settings.queueValueCount}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs text-white/60">Acceptance</div>
                <input
                  name="queueAcceptanceCount"
                  type="number"
                  min={0}
                  defaultValue={settings.queueAcceptanceCount}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs text-white/60">Exploration</div>
                <input
                  name="queueExplorationCount"
                  type="number"
                  min={0}
                  defaultValue={settings.queueExplorationCount}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                />
              </label>
            </div>
            <div className="mt-2 text-xs text-white/50">
              Tip: keep totals at 20 for Devon’s daily workflow.
            </div>
          </div>
        </div>

        <div className="surface p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Disclaimer</div>
          <textarea
            name="disclaimerText"
            defaultValue={settings.disclaimerText ?? ""}
            rows={5}
            placeholder="Add the required disclaimer block here…"
            className="mt-3 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
          />
        </div>

        <button className="btn btn-primary px-4">
          Save settings
        </button>
      </form>
    </div>
  );
}
