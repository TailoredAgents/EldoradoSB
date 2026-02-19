"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie, setSessionCookie, verifyPasswordOrThrow } from "@/lib/auth";

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  try {
    verifyPasswordOrThrow(password);
  } catch {
    redirect("/login?error=1");
  }

  await setSessionCookie();
  redirect("/outreach-today");
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}
