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
      className="btn btn-secondary px-3 py-1.5 text-xs"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

