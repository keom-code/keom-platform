"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@keom/ui";
import type { NavItem } from "@/config/nav";
import { NAV_ICONS } from "@/config/nav-icons";

export function Sidebar({ navItems }: { navItems: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación principal"
      className="hidden w-56 shrink-0 flex-col gap-1 border-r p-4 md:flex"
    >
      {navItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = NAV_ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
