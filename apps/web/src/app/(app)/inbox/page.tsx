import Link from "next/link";
import { prisma } from "@el-dorado/db";
import { sendManualXDmAction } from "./serverActions";
import { QuickReplyComposer } from "@/components/QuickReplyComposer";

export const dynamic = "force-dynamic";

function formatTs(d: Date) {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function isObj(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object";
}

function metaString(meta: unknown, key: string): string | null {
  if (!isObj(meta)) return null;
  const v = meta[key];
  return typeof v === "string" ? v : null;
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams?: { t?: string };
}) {
  const platform = "x";

  const xSettings = await prisma.xAccountSettings.findUnique({
    where: { id: 1 },
    select: { disclaimerText: true },
  });
  const disclaimer = (xSettings?.disclaimerText && String(xSettings.disclaimerText).trim()) || "21+ | Terms apply | Gamble responsibly";

  const threads = await prisma.conversationMessage.groupBy({
    by: ["threadKey", "userId"],
    where: { platform },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: 50,
  });

  const threadKey =
    typeof searchParams?.t === "string"
      ? searchParams.t
      : threads[0]?.threadKey ?? null;

  const messages = threadKey
    ? await prisma.conversationMessage.findMany({
        where: { platform, threadKey },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          id: true,
          createdAt: true,
          direction: true,
          text: true,
          meta: true,
        },
      })
    : [];

  const selectedUserId =
    threads.find((t) => t.threadKey === threadKey)?.userId ??
    (threadKey?.startsWith("x_dm:") ? threadKey.slice("x_dm:".length) : "");

  const lastLinkMsg = [...messages]
    .reverse()
    .find((m) => m.direction === "outbound" && (metaString(m.meta, "trackingLinkId") || metaString(m.meta, "trackingToken")));

  const trackingLinkId = lastLinkMsg ? metaString(lastLinkMsg.meta, "trackingLinkId") : null;
  const trackingToken = lastLinkMsg ? metaString(lastLinkMsg.meta, "trackingToken") : null;
  const linkSentAt = lastLinkMsg?.createdAt ?? null;

  const clickCount =
    trackingLinkId && linkSentAt
      ? await prisma.clickEvent.count({ where: { trackingLinkId, createdAt: { gte: linkSentAt } } })
      : 0;

  const manualNeeded = await prisma.xActionLog.findMany({
    where: { actionType: "dm", status: "skipped", reason: "manual:dm_needed" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { createdAt: true, meta: true },
  });

  const manualThreads = manualNeeded
    .map((r) => {
      const userId = metaString(r.meta, "targetUserId");
      if (!userId) return null;
      return { userId, threadKey: `x_dm:${userId}`, createdAt: r.createdAt };
    })
    .filter((x): x is { userId: string; threadKey: string; createdAt: Date } => Boolean(x));

  return (
    <div className="grid gap-6 md:grid-cols-[280px_1fr]">
      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h1 className="text-lg font-semibold">Inbox</h1>
          <Link
            href="/export/conversations?platform=x&format=openai"
            className="text-xs text-white/70 hover:text-white"
          >
            Export JSONL
          </Link>
        </div>

        {manualThreads.length > 0 ? (
          <div className="mb-3 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3">
            <div className="text-xs font-semibold text-amber-200">Needs manual reply</div>
            <div className="mt-2 space-y-1">
              {manualThreads.slice(0, 6).map((t) => (
                <Link
                  key={`${t.threadKey}:${t.createdAt.toISOString()}`}
                  href={`/inbox?t=${encodeURIComponent(t.threadKey)}`}
                  className="block text-xs text-amber-100/90 hover:underline"
                >
                  {t.threadKey} · {formatTs(t.createdAt)}
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-1">
          {threads.length === 0 ? (
            <div className="text-sm text-white/60">No DM messages captured yet.</div>
          ) : (
            threads.map((t) => (
              <Link
                key={t.threadKey}
                href={`/inbox?t=${encodeURIComponent(t.threadKey)}`}
                className={`block rounded-md px-3 py-2 text-sm ${
                  t.threadKey === threadKey ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/5"
                }`}
              >
                <div className="truncate font-medium">{t.threadKey}</div>
                <div className="text-xs text-white/60">{t._max.createdAt ? formatTs(t._max.createdAt) : ""}</div>
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/5 p-4">
        {!threadKey ? (
          <div className="text-sm text-white/70">Select a thread to view messages.</div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{threadKey}</div>
                <div className="text-xs text-white/60">Messages shown: {messages.length}</div>
                {trackingLinkId ? (
                  <div className="mt-1 text-xs text-white/60">
                    Link:{" "}
                    <span className={clickCount > 0 ? "text-emerald-200" : "text-white/70"}>
                      {clickCount > 0 ? `clicked (${clickCount})` : "not clicked yet"}
                    </span>
                    {trackingToken ? <span className="text-white/50"> · token {trackingToken}</span> : null}
                  </div>
                ) : null}
              </div>
              {selectedUserId ? (
                <a
                  className="text-xs text-white/70 hover:text-white"
                  href={`https://x.com/messages/compose?recipient_id=${encodeURIComponent(selectedUserId)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in X
                </a>
              ) : null}
            </div>

            <div className="space-y-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-md border border-white/10 p-3 text-sm ${
                    m.direction === "outbound" ? "bg-emerald-500/10" : "bg-white/5"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs text-white/60">
                    <span>{m.direction}</span>
                    <span>{formatTs(m.createdAt)}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-white/90">{m.text}</div>
                </div>
              ))}
            </div>

            {selectedUserId ? (
              <form action={sendManualXDmAction} className="mt-4 space-y-2">
                <input type="hidden" name="userId" value={selectedUserId} />
                <input type="hidden" name="threadKey" value={threadKey} />
                <QuickReplyComposer
                  name="text"
                  placeholder="Devon reply (manual). Keep it human and concise."
                  templates={[
                    {
                      label: "Ask LINK PAYOUT",
                      text: `If you want the signup link + 200% match, reply "LINK PAYOUT" and I’ll send it.\n\n${disclaimer}`,
                    },
                    {
                      label: "Ask LINK PICKS",
                      text: `If you want the signup link + 200% match, reply "LINK PICKS" and I’ll send it.\n\n${disclaimer}`,
                    },
                    {
                      label: "Ask LINK GEN",
                      text: `If you want the signup link + 200% match, reply "LINK GEN" and I’ll send it.\n\n${disclaimer}`,
                    },
                    {
                      label: "Help prompt",
                      text: `If you’re stuck depositing, reply HELP and tell me which method you’re using (Cash App/Venmo/Zelle/PayPal/Apple Pay/crypto).\n\n${disclaimer}`,
                    },
                  ]}
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="submit"
                    className="rounded-md bg-white px-3 py-2 text-sm font-medium text-black hover:bg-white/90"
                  >
                    Send DM
                  </button>
                </div>
              </form>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
