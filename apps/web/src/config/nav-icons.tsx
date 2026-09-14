import { BarChart3Icon, BellIcon, ListChecksIcon, TrendingDownIcon, type LucideIcon } from "lucide-react";
import type { NavIconKey } from "./nav";

/**
 * Resolved directly by nav-rendering Client Components (Sidebar, BottomTabBar) via a
 * plain import — never passed as a prop from a Server Component. See nav.ts for why.
 */
export const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  alerts: BellIcon,
  risk: TrendingDownIcon,
  reports: BarChart3Icon,
  "admin-alerts": ListChecksIcon,
};
