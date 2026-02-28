"use client";

import { useTransition } from "react";
import { logoutAction } from "@/lib/authActions";

export function LogoutButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => logoutAction())}
      className="btn btn-secondary py-1.5"
      disabled={isPending}
    >
      {isPending ? "Logging out…" : "Logout"}
    </button>
  );
}

