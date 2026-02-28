"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";

type NavItem = { href: string; label: string; activePrefix?: string };

const NAV: NavItem[] = [
  { href: "/outreach-today", label: "Outreach", activePrefix: "/outreach-today" },
  { href: "/prospects?bucket=new", label: "Prospects", activePrefix: "/prospects" },
  { href: "/inbox", label: "Inbox", activePrefix: "/inbox" },
  { href: "/reports", label: "Reports", activePrefix: "/reports" },
  { href: "/x", label: "X", activePrefix: "/x" },
  { href: "/reddit", label: "Reddit", activePrefix: "/reddit" },
  { href: "/campaigns", label: "Campaigns", activePrefix: "/campaigns" },
  { href: "/templates", label: "Templates", activePrefix: "/templates" },
  { href: "/usage", label: "Usage", activePrefix: "/usage" },
  { href: "/settings", label: "Settings", activePrefix: "/settings" },
];

function isActive(pathname: string, item: NavItem): boolean {
  const p = item.activePrefix ?? item.href;
  return pathname === p || (p !== "/" && pathname.startsWith(p));
}

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/60 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/40">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <Link href="/outreach-today" className="font-semibold tracking-tight text-white/90 hover:text-white">
            Eldorado SB Agent
          </Link>
          <span className="chip chip-amber rounded-full px-2 py-0.5">
            internal
          </span>
        </div>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                isActive(pathname, item)
                  ? "bg-white/10 text-white ring-1 ring-white/10"
                  : "text-white/70 hover:bg-white/5 hover:text-white"
              }`}
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
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition-colors ${
                isActive(pathname, item)
                  ? "bg-white/10 text-white ring-1 ring-white/10"
                  : "bg-white/5 text-white/75"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
