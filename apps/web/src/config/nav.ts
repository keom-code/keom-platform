export type NavIconKey = "alerts" | "risk" | "reports" | "admin-alerts";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconKey;
}

// Deliberately 2 items per role for the MVP — see docs/ARCHITECTURE.md Section A/E:
// a bottom tab bar (not a drawer) is the mobile nav pattern chosen for this depth.
//
// `icon` is a key, not a component reference: NavItem is passed from Server Components
// (SellerLayout/AdminLayout) into Client Components (Sidebar/BottomTabBar), and a Lucide
// icon component isn't serializable across that boundary. Each client component resolves
// the key to an icon via NAV_ICONS in its own module scope instead.
export const sellerNav: NavItem[] = [
  { label: "Alertas", href: "/seller/alerts", icon: "alerts" },
  { label: "Riesgo", href: "/seller/risk", icon: "risk" },
];

export const adminNav: NavItem[] = [
  { label: "Reportes", href: "/admin/reports", icon: "reports" },
  { label: "Alertas", href: "/admin/alerts", icon: "admin-alerts" },
];
