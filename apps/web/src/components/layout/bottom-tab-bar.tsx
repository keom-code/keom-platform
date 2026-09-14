"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@keom/ui";
import type { NavItem } from "@/config/nav";
import { NAV_ICONS } from "@/config/nav-icons";

export function BottomTabBar({ navItems }: { navItems: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
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
              "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium",
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
