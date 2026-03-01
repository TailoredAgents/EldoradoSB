"use client";

import { useMemo, useState } from "react";

type Playbook = { key: string; label: string; text: string; enabled?: boolean };
type Playbooks = { x: Playbook[]; reddit: Playbook[] };

function normalizeKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function makeKey(seed: string): string {
  const base = normalizeKey(seed) || "playbook";
  const suffix = Math.random().toString(16).slice(2, 8);
  return `${base}_${suffix}`;
}

function clampText(t: string, max: number): string {
  const s = String(t ?? "");
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function uniqKey(keys: Set<string>, desired: string): string {
  const base = normalizeKey(desired) || "playbook";
  if (!keys.has(base)) return base;
  for (let i = 2; i < 2000; i += 1) {
    const k = `${base}_${i}`;
    if (!keys.has(k)) return k;
  }
  return makeKey(base);
}

function keysIn(pb: Playbooks): Set<string> {
  return new Set([...pb.x, ...pb.reddit].map((p) => p.key));
}

function sanitize(playbooks: Playbooks): Playbooks {
  const keys = keysIn(playbooks);

  const fix = (list: Playbook[]) =>
    list.map((p) => {
      const label = clampText(String(p.label ?? "").trim(), 60);
      const text = clampText(String(p.text ?? ""), 4000);
      const enabled = p.enabled !== false;
      const desiredKey = String(p.key ?? "").trim() || label || "playbook";
      const key = uniqKey(keys, desiredKey);
      keys.add(key);
      return { key, label: label || key, text, enabled };
    });

  return { x: fix(playbooks.x ?? []), reddit: fix(playbooks.reddit ?? []) };
}

export function PlaybookEditor(props: {
  initial: Playbooks;
  action: (formData: FormData) => void;
}) {
  const initial = useMemo(() => sanitize(props.initial), [props.initial]);
  const [playbooks, setPlaybooks] = useState<Playbooks>(initial);

  const add = (platform: "x" | "reddit") => {
    setPlaybooks((prev) => {
      const next = { ...prev, [platform]: [...prev[platform]] } as Playbooks;
      next[platform].push({
        key: makeKey(platform),
        label: platform === "x" ? "New X reply" : "New Reddit reply",
        text: "",
        enabled: true,
      });
      return next;
    });
  };

  const update = (platform: "x" | "reddit", idx: number, patch: Partial<Playbook>) => {
    setPlaybooks((prev) => {
      const next = { ...prev, [platform]: [...prev[platform]] } as Playbooks;
      const current = next[platform][idx];
      if (!current) return prev;
      next[platform][idx] = { ...current, ...patch };
      return next;
    });
  };

  const remove = (platform: "x" | "reddit", idx: number) => {
    setPlaybooks((prev) => {
      const next = { ...prev, [platform]: [...prev[platform]] } as Playbooks;
      next[platform].splice(idx, 1);
      return next;
    });
  };

  const renderList = (platform: "x" | "reddit") => {
    const list = playbooks[platform] ?? [];
    return (
      <div className="space-y-3">
        {list.length === 0 ? (
          <div className="text-sm text-white/60">No playbooks yet.</div>
        ) : (
          list.map((p, idx) => (
            <div key={p.key} className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-[260px] flex-1">
                  <div className="grid gap-2 md:grid-cols-[220px_1fr]">
                    <label className="block">
                      <div className="mb-1 text-xs text-white/60">Label</div>
                      <input
                        value={p.label}
                        onChange={(e) => update(platform, idx, { label: e.target.value })}
                        className="app-input"
                        placeholder="Ask LINK PAYOUT"
                      />
                    </label>
                    <label className="block">
                      <div className="mb-1 text-xs text-white/60">Key</div>
                      <input
                        value={p.key}
                        onChange={(e) => update(platform, idx, { key: normalizeKey(e.target.value) })}
                        className="app-input font-mono text-xs"
                        placeholder="x_ask_link_payout"
                      />
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-white/70">
                    <input
                      type="checkbox"
                      checked={p.enabled !== false}
                      onChange={(e) => update(platform, idx, { enabled: e.target.checked })}
                      className="h-4 w-4 accent-amber-400"
                    />
                    Enabled
                  </label>
                  <button type="button" onClick={() => remove(platform, idx)} className="btn btn-ghost px-3 text-xs">
                    Remove
                  </button>
                </div>
              </div>

              <label className="mt-3 block">
                <div className="mb-1 text-xs text-white/60">Text</div>
                <textarea
                  value={p.text}
                  onChange={(e) => update(platform, idx, { text: e.target.value })}
                  rows={4}
                  className="app-input font-mono text-xs"
                  placeholder={"Use {{disclaimer}} and {{x_handle}} if you want."}
                />
              </label>
            </div>
          ))
        )}

        <button type="button" onClick={() => add(platform)} className="btn btn-secondary px-4">
          Add {platform === "x" ? "X" : "Reddit"} playbook
        </button>
      </div>
    );
  };

  const payload = useMemo(() => JSON.stringify(sanitize(playbooks)), [playbooks]);

  return (
    <form action={props.action} className="space-y-4">
      <input type="hidden" name="playbooksJson" value={payload} />

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-white/60">X playbooks</div>
          {renderList("x")}
        </div>
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-white/60">Reddit playbooks</div>
          {renderList("reddit")}
        </div>
      </div>

      <div className="flex items-center justify-end">
        <button type="submit" className="btn btn-primary px-4">
          Save playbooks
        </button>
      </div>
    </form>
  );
}

