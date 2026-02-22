import { NextResponse, type NextRequest } from "next/server";
import { exchangeXOAuthCodeAction } from "@/app/(app)/x/serverActions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  if (err) return NextResponse.redirect(new URL("/x?error=1", url.origin), { status: 302 });
  if (!code || !state) {
    return NextResponse.redirect(new URL("/x?error=1", url.origin), { status: 302 });
  }

  try {
    await exchangeXOAuthCodeAction({ code, state });
    return NextResponse.redirect(new URL("/x?ok=1", url.origin), { status: 302 });
  } catch {
    return NextResponse.redirect(new URL("/x?error=1", url.origin), { status: 302 });
  }
}

