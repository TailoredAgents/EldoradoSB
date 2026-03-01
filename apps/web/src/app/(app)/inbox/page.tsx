import Link from "next/link";
import { prisma } from "@el-dorado/db";
import { logConversationOutcomeAction, sendManualRedditDmAction, sendManualXDmAction } from "./serverActions";
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
  searchParams?: { t?: string; p?: string; ok?: string };
}) {
  const platform = searchParams?.p === "reddit" ? "reddit" : "x";
  const ok = searchParams?.ok === "1";

  const xSettings =
    platform === "x"
      ? await prisma.xAccountSettings.findUnique({
          where: { id: 1 },
          select: { disclaimerText: true },
        })
      : null;
  const disclaimer =
    (xSettings?.disclaimerText && String(xSettings.disclaimerText).trim()) ||
    "21+ | Terms apply | Gamble responsibly";

  const threads = await prisma.conversationMessage.groupBy({
    by: ["threadKey", "userId"],
    where: { platform },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: 50,
  });

  const threadUserIds = Array.from(new Set(threads.map((t) => t.userId).filter((x): x is string => Boolean(x))));
  const users =
    threadUserIds.length > 0
      ? await prisma.externalUser.findMany({
          where: { platform, userId: { in: threadUserIds } },
          select: { userId: true, handle: true, name: true },
        })
      : [];
  const userById = new Map(users.map((u) => [u.userId, { handle: u.handle, name: u.name }]));

  const threadKeys = threads.map((t) => t.threadKey);
  const latestOutcomes = threadKeys.length
    ? await prisma.conversationOutcome.findMany({
        where: { platform, threadKey: { in: threadKeys } },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { threadKey: true, tag: true, createdAt: true },
      })
    : [];
  const latestOutcomeByThread = new Map<string, { tag: string; createdAt: Date }>();
  for (const o of latestOutcomes) {
    if (!latestOutcomeByThread.has(o.threadKey)) latestOutcomeByThread.set(o.threadKey, { tag: o.tag, createdAt: o.createdAt });
  }

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

  const selectedRedditUser =
    threads.find((t) => t.threadKey === threadKey)?.userId ??
    (threadKey?.startsWith("reddit_dm:") ? threadKey.slice("reddit_dm:".length) : "");

  const selectedExternal = platform === "x" && selectedUserId ? userById.get(selectedUserId) ?? null : null;
  const selectedLabel =
    platform === "x"
      ? selectedExternal?.handle
        ? `@${selectedExternal.handle}`
        : selectedUserId
          ? `x user ${selectedUserId}`
          : threadKey ?? ""
      : selectedRedditUser
        ? `u/${selectedRedditUser}`
        : threadKey ?? "";

  const lastLinkMsg =
    platform === "x"
      ? [...messages]
          .reverse()
          .find(
            (m) =>
              m.direction === "outbound" &&
              (metaString(m.meta, "trackingLinkId") || metaString(m.meta, "trackingToken")),
          )
      : null;

  const trackingLinkId =
    lastLinkMsg && platform === "x" ? metaString(lastLinkMsg.meta, "trackingLinkId") : null;
  const trackingToken =
    lastLinkMsg && platform === "x" ? metaString(lastLinkMsg.meta, "trackingToken") : null;
  const linkSentAt = lastLinkMsg?.createdAt ?? null;

  const clickCount =
    platform === "x" && trackingLinkId && linkSentAt
      ? await prisma.clickEvent.count({
          where: { trackingLinkId, createdAt: { gte: linkSentAt } },
        })
      : 0;

  const outcomes = threadKey
    ? await prisma.conversationOutcome.findMany({
        where: { platform, threadKey },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, createdAt: true, tag: true, depositors: true, depositsUsd: true, notes: true },
      })
    : [];

  const manualThreads =
    platform === "x"
      ? (
          await prisma.xActionLog.findMany({
            where: { actionType: "dm", status: "skipped", reason: "manual:dm_needed" },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { createdAt: true, meta: true },
          })
        )
          .map((r) => {
            const userId = metaString(r.meta, "targetUserId");
            if (!userId) return null;
            return { userId, threadKey: `x_dm:${userId}`, createdAt: r.createdAt };
          })
          .filter((x): x is { userId: string; threadKey: string; createdAt: Date } => Boolean(x))
      : [];

  return (
    <div className="grid gap-6 md:grid-cols-[280px_1fr]">
      <section className="surface p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h1 className="text-lg font-semibold">Inbox</h1>
          <div className="flex items-center gap-3">
            <Link
              href={`/inbox?p=x${threadKey ? `&t=${encodeURIComponent(threadKey)}` : ""}`}
              className={`text-xs ${platform === "x" ? "text-white" : "text-white/60 hover:text-white"}`}
            >
              X
            </Link>
            <Link
              href={`/inbox?p=reddit${threadKey ? `&t=${encodeURIComponent(threadKey)}` : ""}`}
              className={`text-xs ${platform === "reddit" ? "text-white" : "text-white/60 hover:text-white"}`}
            >
              Reddit
            </Link>
            <Link
              href={`/export/conversations?platform=${encodeURIComponent(platform)}&format=openai`}
              className="text-xs text-white/70 hover:text-white"
            >
              Export JSONL
            </Link>
          </div>
        </div>

        {ok ? (
          <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            Outcome saved.
          </div>
        ) : null}

        {manualThreads.length > 0 ? (
          <div className="mb-3 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3">
            <div className="text-xs font-semibold text-amber-200">Needs manual reply</div>
            <div className="mt-2 space-y-1">
              {manualThreads.slice(0, 6).map((t) => (
                <Link
                  key={`${t.threadKey}:${t.createdAt.toISOString()}`}
                  href={`/inbox?p=${encodeURIComponent(platform)}&t=${encodeURIComponent(t.threadKey)}`}
                  className="block text-xs text-amber-100/90 hover:underline"
                >
                  {userById.get(t.userId)?.handle ? `@${userById.get(t.userId)!.handle}` : t.threadKey} ·{" "}
                  {formatTs(t.createdAt)}
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
                  href={`/inbox?p=${encodeURIComponent(platform)}&t=${encodeURIComponent(t.threadKey)}`}
                  className={`block rounded-md px-3 py-2 text-sm ${
                    t.threadKey === threadKey ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="truncate font-medium">
                      {platform === "x"
                        ? t.userId && userById.get(t.userId)?.handle
                          ? `@${userById.get(t.userId)!.handle}`
                          : t.userId
                            ? `x user ${t.userId}`
                            : t.threadKey
                        : t.userId
                          ? `u/${t.userId}`
                          : t.threadKey}
                    </div>
                    {latestOutcomeByThread.get(t.threadKey)?.tag ? (
                      <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/60">
                        {latestOutcomeByThread.get(t.threadKey)!.tag.replace(/_/g, " ")}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-xs text-white/60">{t._max.createdAt ? formatTs(t._max.createdAt) : ""}</div>
                </Link>
              ))
          )}
        </div>
      </section>

      <section className="surface p-4">
        {!threadKey ? (
          <div className="text-sm text-white/70">Select a thread to view messages.</div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{selectedLabel}</div>
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
              ) : platform === "reddit" ? (
                <a
                  className="text-xs text-white/70 hover:text-white"
                  href="https://www.reddit.com/message/inbox/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Reddit
                </a>
              ) : null}
            </div>

            <div className="mb-4 rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-white/60">Outcome</div>
                  <div className="mt-1 text-xs text-white/50">
                    Log what happened for this conversation (Devon-friendly; no tokens required).
                  </div>
                </div>
                {outcomes[0] ? (
                  <div className="text-xs text-white/60">
                    Latest: <span className="text-white/80">{outcomes[0].tag.replace(/_/g, " ")}</span>{" "}
                    <span className="text-white/40">· {formatTs(outcomes[0].createdAt)}</span>
                  </div>
                ) : (
                  <div className="text-xs text-white/60">No outcomes logged yet.</div>
                )}
              </div>

              <form
                action={logConversationOutcomeAction}
                className="mt-3 grid gap-3 md:grid-cols-[220px_120px_140px_1fr_auto]"
              >
                <input type="hidden" name="platform" value={platform} />
                <input type="hidden" name="threadKey" value={threadKey} />
                <input
                  type="hidden"
                  name="userId"
                  value={platform === "x" ? selectedUserId : selectedRedditUser}
                />

                <label className="block">
                  <div className="mb-1 text-xs text-white/60">Result</div>
                  <select name="tag" className="app-select">
                    <option value="deposit_confirmed">Deposit confirmed</option>
                    <option value="asked_fee">Asked for fee</option>
                    <option value="declined">Declined</option>
                    <option value="no_response">No response</option>
                    <option value="support_needed">Support needed</option>
                    <option value="ambassador_interested">Ambassador interested</option>
                    <option value="do_not_contact">Do not contact</option>
                    <option value="other">Other</option>
                  </select>
                </label>

                <label className="block">
                  <div className="mb-1 text-xs text-white/60">Depositors</div>
                  <input name="depositors" inputMode="numeric" placeholder="1" className="app-input" />
                </label>

                <label className="block">
                  <div className="mb-1 text-xs text-white/60">Deposits ($)</div>
                  <input name="depositsUsd" inputMode="decimal" placeholder="100" className="app-input" />
                </label>

                <label className="block">
                  <div className="mb-1 text-xs text-white/60">Notes</div>
                  <input name="notes" placeholder="Optional context…" className="app-input" />
                </label>

                <div className="flex items-end justify-end">
                  <button type="submit" className="btn btn-primary px-4">
                    Save
                  </button>
                </div>
              </form>

              {outcomes.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {outcomes.map((o) => (
                    <div
                      key={o.id}
                      className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-white/70"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="font-medium text-white/80">{o.tag.replace(/_/g, " ")}</div>
                        <div className="text-white/50">{formatTs(o.createdAt)}</div>
                      </div>
                      {o.depositors != null || o.depositsUsd != null || o.notes ? (
                        <div className="mt-1 text-white/60">
                          {o.depositors != null ? <span>depositors {o.depositors}</span> : null}
                          {o.depositsUsd != null ? (
                            <span>{o.depositors != null ? " · " : ""}${o.depositsUsd.toFixed(2)}</span>
                          ) : null}
                          {o.notes ? (
                            <span>
                              {o.depositors != null || o.depositsUsd != null ? " · " : ""}
                              {o.notes}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
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

            {platform === "x" && selectedUserId ? (
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
            ) : platform === "reddit" && selectedRedditUser ? (
              <form action={sendManualRedditDmAction} className="mt-4 space-y-2">
                <input type="hidden" name="username" value={selectedRedditUser} />
                <input type="hidden" name="threadKey" value={threadKey} />
                <label className="block">
                  <div className="mb-1 text-xs text-white/60">Subject (optional)</div>
                  <input name="subject" className="app-input" placeholder="Re:" />
                </label>
                <QuickReplyComposer
                  name="text"
                  placeholder="Devon reply (manual). Value first; keep it human and concise."
                  templates={[
                    {
                      label: "Ask DM on X (PAYOUT)",
                      text: `If you want our signup link + 200% match, DM @EldoradoSB on X with \"LINK PAYOUT REDDIT\".\n\n21+ | Terms apply | Gamble responsibly`,
                    },
                    {
                      label: "Ask DM on X (PICKS)",
                      text: `If you want our signup link + 200% match, DM @EldoradoSB on X with \"LINK PICKS REDDIT\".\n\n21+ | Terms apply | Gamble responsibly`,
                    },
                    {
                      label: "Ask DM on X (GEN)",
                      text: `If you want our signup link + 200% match, DM @EldoradoSB on X with \"LINK GEN REDDIT\".\n\n21+ | Terms apply | Gamble responsibly`,
                    },
                    {
                      label: "Value only",
                      text: `Totally fair. Quick tip: start small, track every bet, and don’t scale until you’ve proven you can withdraw cleanly.\n\n21+ | Terms apply | Gamble responsibly`,
                    },
                  ]}
                />
                <div className="flex items-center justify-between gap-2">
                  <a
                    className="text-xs text-white/60 hover:text-white"
                    href="https://www.reddit.com/message/inbox/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Reddit inbox
                  </a>
                  <button type="submit" className="btn btn-primary px-4">
                    Send Reddit DM
                  </button>
                </div>
                <div className="text-xs text-white/50">
                  Requires Reddit env vars to be set in Render when you enable it.
                </div>
              </form>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
