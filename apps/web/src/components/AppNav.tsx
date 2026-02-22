import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";

const NAV = [
  { href: "/outreach-today", label: "Outreach Today" },
  { href: "/prospects?bucket=new", label: "New" },
  { href: "/prospects?bucket=in-progress", label: "In Progress" },
  { href: "/prospects?bucket=done", label: "Done" },
  { href: "/reports", label: "Reports" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/x", label: "Eldorado X" },
  { href: "/templates", label: "Templates" },
  { href: "/usage", label: "Usage" },
  { href: "/settings", label: "Settings" },
];

export function AppNav() {
  return (
    <header className="border-b border-white/10 bg-black/30 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <Link href="/outreach-today" className="font-semibold tracking-tight">
            El Dorado SB Outreach Agent
          </Link>
          <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-xs text-amber-200">
            internal
          </span>
        </div>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-sm text-white/80 hover:bg-white/5 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <LogoutButton />
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-3 md:hidden">
        <div className="flex flex-wrap gap-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md bg-white/5 px-3 py-1.5 text-xs text-white/80"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
