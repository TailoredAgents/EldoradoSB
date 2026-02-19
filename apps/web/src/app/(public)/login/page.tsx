import { loginAction } from "@/lib/authActions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const { error } = searchParams;

  return (
    <div className="min-h-screen px-4 py-16">
      <div className="mx-auto w-full max-w-sm rounded-2xl border border-white/10 bg-black/40 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
        <div className="mb-6">
          <div className="text-sm text-amber-200/90">El Dorado</div>
          <h1 className="text-2xl font-semibold tracking-tight">
            SB Outreach Agent
          </h1>
          <p className="mt-2 text-sm text-white/70">
            Password required (internal).
          </p>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            Invalid password.
          </div>
        ) : null}

        <form action={loginAction} className="space-y-3">
          <label className="block">
            <div className="mb-1 text-sm text-white/70">Password</div>
            <input
              name="password"
              type="password"
              autoFocus
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white placeholder:text-white/30 outline-none focus:border-amber-400/50"
              placeholder="••••••••"
              required
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-lg bg-amber-400 px-3 py-2 font-medium text-black hover:bg-amber-300"
          >
            Login
          </button>
        </form>

        <div className="mt-6 text-xs text-white/50">
          This site is not indexed and is intended for internal use.
        </div>
      </div>
    </div>
  );
}
