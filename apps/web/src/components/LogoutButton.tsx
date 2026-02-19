"use client";

import { useTransition } from "react";
import { logoutAction } from "@/lib/authActions";

export function LogoutButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => logoutAction())}
      className="rounded-md bg-white/5 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-50"
      disabled={isPending}
    >
      {isPending ? "Logging out…" : "Logout"}
    </button>
  );
}

