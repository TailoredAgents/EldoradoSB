"use client";

import { useMemo, useState } from "react";

type Template = { label: string; text: string };

export function QuickReplyComposer(props: {
  name: string;
  placeholder?: string;
  templates: Template[];
}) {
  const [text, setText] = useState("");

  const templates = useMemo(() => props.templates.filter((t) => t.text.trim()), [props.templates]);

  return (
    <div className="space-y-2">
      {templates.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setText(t.text)}
              className="rounded-md bg-white/10 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/15"
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setText("")}
            className="rounded-md bg-white/5 px-2.5 py-1.5 text-xs text-white/60 hover:bg-white/10"
          >
            Clear
          </button>
        </div>
      ) : null}

      <textarea
        name={props.name}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/40"
        placeholder={props.placeholder}
        required
      />
    </div>
  );
}

