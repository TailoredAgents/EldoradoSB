"use client";

import { useState } from "react";

export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1000);
      }}
      className="rounded-md bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

