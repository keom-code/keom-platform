import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SessionProvider } from "@/providers/session-provider";
import { QueryProvider } from "@/providers/query-provider";
import { AppShell } from "@/components/layout/app-shell";
import { sellerNav } from "@/config/nav";

export default async function SellerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "SELLER") redirect("/admin/reports");

  return (
    <SessionProvider user={session}>
      <QueryProvider>
        <AppShell navItems={sellerNav}>{children}</AppShell>
      </QueryProvider>
    </SessionProvider>
  );
}
