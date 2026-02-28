import Link from "next/link";
import { prisma } from "@el-dorado/db";
import { sendManualXDmAction } from "./serverActions";

export const dynamic = "force-dynamic";

function formatTs(d: Date) {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams?: { t?: string };
}) {
  const platform = "x";

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
        },
      })
    : [];

  const selectedUserId =
    threads.find((t) => t.threadKey === threadKey)?.userId ??
    (threadKey?.startsWith("x_dm:") ? threadKey.slice("x_dm:".length) : "");

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
                <textarea
                  name="text"
                  rows={4}
                  className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/40"
                  placeholder="Devon reply (manual). Keep it human and concise."
                  required
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

