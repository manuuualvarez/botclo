"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/admin", label: "Resumen", exact: true },
  { href: "/admin/usuarios", label: "Usuarios", exact: false },
  { href: "/admin/planes", label: "Planes y precios", exact: false },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-white/5">
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
                  ? "border-violet-400 text-foreground"
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
