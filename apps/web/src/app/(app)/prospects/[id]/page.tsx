import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@el-dorado/db";
import { ProspectStatus } from "@el-dorado/db";
import {
  updateProspectNotesAction,
  updateProspectOwnerAction,
  updateProspectStatusAction,
  addOutreachEventAction,
} from "../serverActions";
import { CopyButton } from "@/components/CopyButton";

export const dynamic = "force-dynamic";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string") as string[];
}

export default async function ProspectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const prospect = await prisma.prospect.findUnique({
    where: { id },
    include: {
      postSamples: { orderBy: { sampledAt: "desc" }, take: 12 },
      outreachEvents: { orderBy: { eventAt: "desc" }, take: 25 },
    },
  });

  if (!prospect) notFound();

  const rationale = asStringArray(prospect.rationale);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-white/60">Prospect</div>
          <h1 className="text-2xl font-semibold tracking-tight">
            @{prospect.handle}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white/70">
            <a
              href={`https://x.com/${prospect.handle}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-white/5 px-2 py-1 hover:bg-white/10"
            >
              Open on X
            </a>
            <Link
              href="/prospects?bucket=new"
              className="rounded-md bg-white/5 px-2 py-1 hover:bg-white/10"
            >
              Back to list
            </Link>
          </div>
        </div>

        <form action={updateProspectStatusAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={prospect.id} />
          <select
            name="status"
            defaultValue={prospect.status}
            className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
          >
            {Object.values(ProspectStatus).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="rounded-md bg-amber-400 px-3 py-2 text-sm font-medium text-black hover:bg-amber-300">
            Update status
          </button>
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="surface p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Scores</div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-lg font-semibold tabular-nums">
                {prospect.performanceScore?.toFixed(0) ?? "—"}
              </div>
              <div className="text-xs text-white/60">Performance</div>
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums">
                {prospect.acceptanceScore?.toFixed(0) ?? "—"}
              </div>
              <div className="text-xs text-white/60">Acceptance</div>
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums text-amber-200">
                {prospect.overallScore?.toFixed(0) ?? "—"}
              </div>
              <div className="text-xs text-white/60">Overall</div>
            </div>
          </div>
          <div className="mt-4 text-sm text-white/70">
            Tier:{" "}
            <span className="rounded-md bg-amber-400/10 px-2 py-1 text-xs text-amber-200">
              {prospect.tier ?? "—"}
            </span>
          </div>
        </div>

        <div className="surface p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Profile</div>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-white/60">Name</dt>
              <dd className="text-right">{prospect.name ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-white/60">Followers</dt>
              <dd className="text-right tabular-nums">
                {prospect.followers?.toLocaleString() ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-white/60">Location</dt>
              <dd className="text-right">{prospect.location ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-white/60">URL</dt>
              <dd className="max-w-[14rem] truncate text-right">
                {prospect.url ? (
                  <a
                    href={prospect.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-200 hover:underline"
                  >
                    {prospect.url}
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div className="surface p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Owner</div>
          <form action={updateProspectOwnerAction} className="mt-3 flex gap-2">
            <input type="hidden" name="id" value={prospect.id} />
            <input
              name="owner"
              defaultValue={prospect.owner ?? ""}
              placeholder="Devon"
              className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
            />
            <button className="rounded-md bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10">
              Save
            </button>
          </form>
          <div className="mt-4 text-xs text-white/50">
            Status is the source of truth for which tab it appears in.
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="surface p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Why this account</div>
          {rationale.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-white/80">
              {rationale.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          ) : (
            <div className="mt-3 text-sm text-white/60">No rationale saved yet.</div>
          )}
        </div>

        <div className="surface p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">Notes</div>
          <form action={updateProspectNotesAction} className="mt-3 space-y-2">
            <input type="hidden" name="id" value={prospect.id} />
            <textarea
              name="notes"
              defaultValue={prospect.notes ?? ""}
              rows={6}
              placeholder="Devon notes…"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
            />
            <button className="rounded-md bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10">
              Save notes
            </button>
          </form>
        </div>
      </div>

      <div className="surface p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-white/60">
              Sampled posts
            </div>
            <div className="mt-1 text-sm text-white/70">
              Stored samples to avoid re-reading from X.
            </div>
          </div>
        </div>

        {prospect.postSamples.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {prospect.postSamples.map((post) => (
              <div
                key={post.id}
                className="rounded-lg border border-white/10 bg-black/40 p-3"
              >
                <div className="line-clamp-4 text-sm text-white/80">
                  {post.text}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/50">
                  <span>likes {post.likes ?? 0}</span>
                  <span>replies {post.replies ?? 0}</span>
                  <span>reposts {post.reposts ?? 0}</span>
                  <span>quotes {post.quotes ?? 0}</span>
                  {post.permalink ? (
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-amber-200 hover:underline"
                    >
                      open
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 text-sm text-white/60">No post samples yet.</div>
        )}
      </div>

      <div className="surface p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-white/60">
              Outreach drafts
            </div>
            <div className="mt-1 text-sm text-white/70">
              Assist-only drafts. Use placeholders:{" "}
              <span className="text-amber-200">{"{{AMBASSADOR_CODE}}"}</span>,{" "}
              <span className="text-amber-200">{"{{SIGNUP_LINK}}"}</span>.
            </div>
          </div>
          {prospect.dmDraft ? (
            <CopyButton text={prospect.dmDraft} label="Copy DM" />
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-black/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-white/60">
                DM
              </div>
              {prospect.dmDraft ? <CopyButton text={prospect.dmDraft} label="Copy" /> : null}
            </div>
            <pre className="whitespace-pre-wrap text-sm text-white/80">
              {prospect.dmDraft ?? "No DM draft yet."}
            </pre>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-white/60">
                Email
              </div>
              {prospect.emailBody ? <CopyButton text={`${prospect.emailSubject ?? ""}\n\n${prospect.emailBody}`} label="Copy" /> : null}
            </div>
            <div className="text-sm text-white/80">
              <div className="text-xs text-white/60">Subject</div>
              <div className="mt-1 rounded-md bg-black/30 px-2 py-1">
                {prospect.emailSubject ?? "—"}
              </div>
              <div className="mt-3 text-xs text-white/60">Body</div>
              <pre className="mt-1 whitespace-pre-wrap rounded-md bg-black/30 px-2 py-2 text-sm">
                {prospect.emailBody ?? "No email draft yet."}
              </pre>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="surface p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">
            Log outreach
          </div>
          <form action={addOutreachEventAction} className="mt-3 space-y-3">
            <input type="hidden" name="prospectId" value={prospect.id} />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <div className="mb-1 text-xs text-white/60">Channel</div>
                <select
                  name="channel"
                  defaultValue="dm"
                  className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                >
                  <option value="dm">dm</option>
                  <option value="email">email</option>
                </select>
              </label>
              <label className="block">
                <div className="mb-1 text-xs text-white/60">Event</div>
                <select
                  name="eventType"
                  defaultValue="contacted"
                  className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                >
                  <option value="queued">queued</option>
                  <option value="contacted">contacted</option>
                  <option value="replied">replied</option>
                  <option value="negotiating">negotiating</option>
                  <option value="signed">signed</option>
                  <option value="weekly_results">weekly_results</option>
                  <option value="rejected">rejected</option>
                  <option value="dnc">dnc</option>
                  <option value="done">done</option>
                </select>
              </label>
            </div>

            <label className="block">
              <div className="mb-1 text-xs text-white/60">Outcome (optional)</div>
              <input
                name="outcome"
                className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                placeholder="e.g., asked for details, wants a call, declined…"
              />
            </label>

            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <div className="mb-1 text-xs text-white/60">Follow-up</div>
                <input
                  name="followUpAt"
                  type="datetime-local"
                  className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 text-xs text-white outline-none focus:border-amber-400/50"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs text-white/60">Depositors</div>
                <input
                  name="depositors"
                  type="number"
                  min={0}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 text-xs text-white outline-none focus:border-amber-400/50"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs text-white/60">Deposits ($)</div>
                <input
                  name="depositsUsd"
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 text-xs text-white outline-none focus:border-amber-400/50"
                />
              </label>
            </div>

            <label className="block">
              <div className="mb-1 text-xs text-white/60">Notes (optional)</div>
              <textarea
                name="notes"
                rows={4}
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
                placeholder="Internal notes…"
              />
            </label>

            <button className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-black hover:bg-amber-300">
              Add event
            </button>
          </form>
        </div>

        <div className="surface p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">
            Outreach history
          </div>
          {prospect.outreachEvents.length ? (
            <div className="mt-3 space-y-2">
              {prospect.outreachEvents.map((e) => (
                <div
                  key={e.id}
                  className="rounded-lg border border-white/10 bg-black/40 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">
                      {e.eventType} <span className="text-white/60">({e.channel})</span>
                    </div>
                    <div className="text-xs text-white/60">
                      {new Date(e.eventAt).toISOString().slice(0, 10)}
                    </div>
                  </div>
                  {e.outcome ? <div className="mt-1 text-white/80">{e.outcome}</div> : null}
                  {(e.depositors != null || e.depositsUsd != null) ? (
                    <div className="mt-2 text-xs text-white/60">
                      depositors: {e.depositors ?? "—"} · deposits: {e.depositsUsd != null ? `$${e.depositsUsd.toFixed(2)}` : "—"}
                    </div>
                  ) : null}
                  {e.followUpAt ? (
                    <div className="mt-1 text-xs text-amber-200/90">
                      follow-up: {new Date(e.followUpAt).toISOString().slice(0, 16).replace("T", " ")}Z
                    </div>
                  ) : null}
                  {e.notes ? (
                    <div className="mt-2 whitespace-pre-wrap text-xs text-white/60">
                      {e.notes}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-white/60">No events yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
