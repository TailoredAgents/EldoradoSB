import { prisma } from "@el-dorado/db";
import { savePlaybooksAction, saveTemplatesAction } from "./serverActions";
import { PlaybookEditor } from "@/components/PlaybookEditor";

export const dynamic = "force-dynamic";

type Playbook = { key: string; label: string; text: string; enabled?: boolean };
type Playbooks = { x: Playbook[]; reddit: Playbook[] };

function isObj(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object";
}

function readPlaybooks(templates: unknown): Playbooks {
  const fallback: Playbooks = {
    x: [
      {
        key: "x_ask_link_payout",
        label: "Ask LINK PAYOUT",
        text: `If you want the signup link + 200% match, reply \"LINK PAYOUT\" and I’ll send it.\n\n{{disclaimer}}`,
        enabled: true,
      },
      {
        key: "x_ask_link_picks",
        label: "Ask LINK PICKS",
        text: `If you want the signup link + 200% match, reply \"LINK PICKS\" and I’ll send it.\n\n{{disclaimer}}`,
        enabled: true,
      },
      {
        key: "x_ask_link_gen",
        label: "Ask LINK GEN",
        text: `If you want the signup link + 200% match, reply \"LINK GEN\" and I’ll send it.\n\n{{disclaimer}}`,
        enabled: true,
      },
      {
        key: "x_help_prompt",
        label: "Help prompt",
        text: `If you’re stuck depositing, reply HELP and tell me which method you’re using (Cash App/Venmo/Zelle/PayPal/Apple Pay/crypto).\n\n{{disclaimer}}`,
        enabled: true,
      },
    ],
    reddit: [
      {
        key: "rd_ask_x_link_payout",
        label: "Ask DM on X (PAYOUT)",
        text: `If you want our signup link + 200% match, DM @{{x_handle}} on X with \"LINK PAYOUT REDDIT\".\n\n{{disclaimer}}`,
        enabled: true,
      },
      {
        key: "rd_ask_x_link_picks",
        label: "Ask DM on X (PICKS)",
        text: `If you want our signup link + 200% match, DM @{{x_handle}} on X with \"LINK PICKS REDDIT\".\n\n{{disclaimer}}`,
        enabled: true,
      },
      {
        key: "rd_ask_x_link_gen",
        label: "Ask DM on X (GEN)",
        text: `If you want our signup link + 200% match, DM @{{x_handle}} on X with \"LINK GEN REDDIT\".\n\n{{disclaimer}}`,
        enabled: true,
      },
      {
        key: "rd_value_only",
        label: "Value only",
        text: `Totally fair. Quick tip: start small, track every bet, and don’t scale until you’ve proven you can withdraw cleanly.\n\n{{disclaimer}}`,
        enabled: true,
      },
    ],
  };

  if (!isObj(templates) || !isObj(templates.playbooks)) return fallback;
  const pb = templates.playbooks as Record<string, unknown>;
  const x = Array.isArray(pb.x) ? pb.x : null;
  const reddit = Array.isArray(pb.reddit) ? pb.reddit : null;
  if (!x && !reddit) return fallback;
  return { x: (x as any) ?? [], reddit: (reddit as any) ?? [] } as Playbooks;
}

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
  const playbooks = readPlaybooks(settings.templates);

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
          {error === "json"
            ? "Templates must be valid JSON."
            : error === "playbooks_json"
              ? "Playbooks must be valid JSON."
              : error === "playbooks"
                ? "Error saving playbooks."
                : "Error saving templates."}
        </div>
      ) : null}

      <div className="surface p-4">
        <div className="text-xs uppercase tracking-wide text-white/60">Devon playbooks</div>
        <div className="mt-2 text-sm text-white/70">
          Manage Devon’s manual reply buttons for X and Reddit (no deploys required). Use{" "}
          <span className="font-mono">{"{{disclaimer}}"}</span> and{" "}
          <span className="font-mono">{"{{x_handle}}"}</span> placeholders if you want.
        </div>
        <div className="mt-4">
          <PlaybookEditor initial={playbooks} action={savePlaybooksAction} />
        </div>
      </div>

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
