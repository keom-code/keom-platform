import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SessionProvider } from "@/providers/session-provider";
import { AppShell } from "@/components/layout/app-shell";
import { adminNav } from "@/config/nav";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/seller/alerts");

  return (
    <SessionProvider user={session}>
      <AppShell navItems={adminNav}>{children}</AppShell>
    </SessionProvider>
  );
}
