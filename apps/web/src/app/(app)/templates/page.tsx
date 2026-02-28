import { prisma } from "@el-dorado/db";
import { saveTemplatesAction } from "./serverActions";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: { ok?: string; error?: string };
}) {
  const { ok, error } = searchParams;
  const settings =
    (await prisma.settings.findUnique({ where: { id: 1 } })) ??
    (await prisma.settings.create({ data: { id: 1 } }));

  const templatesJson = JSON.stringify(settings.templates ?? {}, null, 2);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
        <p className="mt-1 text-sm text-white/70">
          Outreach drafts are assist-only. Store defaults here.
        </p>
      </div>

      {ok ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          Saved.
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error === "json" ? "Templates must be valid JSON." : "Error saving templates."}
        </div>
      ) : null}

      <form action={saveTemplatesAction} className="space-y-4">
        <div className="surface p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">
            Templates JSON
          </div>
          <textarea
            name="templates"
            defaultValue={templatesJson}
            rows={18}
            className="mt-3 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs text-white outline-none focus:border-amber-400/50"
          />
          <div className="mt-2 text-xs text-white/50">
            Store whatever keys you want (e.g., `dm_default`, `email_default`, persona variants).
          </div>
        </div>

        <button className="btn btn-primary px-4">
          Save templates
        </button>
      </form>
    </div>
  );
}
