import type { NavItem } from "@/config/nav";
import { TopNav } from "@/components/layout/top-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { BottomTabBar } from "@/components/layout/bottom-tab-bar";

export function AppShell({
  navItems,
  children,
}: {
  navItems: NavItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav homeHref={navItems[0]?.href ?? "/"} />
      <div className="flex flex-1">
        <Sidebar navItems={navItems} />
        <main className="min-w-0 flex-1 pb-16 md:pb-0">{children}</main>
      </div>
      <BottomTabBar navItems={navItems} />
    </div>
  );
}
