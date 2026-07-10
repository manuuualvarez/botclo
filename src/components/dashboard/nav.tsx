"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/dashboard", label: "Mi cartera", exact: true },
  { href: "/dashboard/estrategias", label: "Estrategias", exact: false },
  { href: "/dashboard/robot", label: "Robot", exact: false },
  { href: "/dashboard/plan", label: "Mi plan", exact: false },
  { href: "/dashboard/perfil", label: "Mi perfil", exact: false },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="scrollbar-none -mx-4 overflow-x-auto border-b border-white/5 px-4 sm:mx-0 sm:px-0">
      <div className="flex gap-6">
        {tabs.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors",
                active
                  ? "border-emerald-400 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
