import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "@/features/auth/components/login-form";
import { siteConfig } from "@/config/site";

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect(session.role === "ADMIN" ? "/admin/reports" : "/seller/alerts");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-xl border p-8">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-xl font-semibold">{siteConfig.name}</h1>
          <p className="text-sm text-muted-foreground">{siteConfig.tagline}</p>
        </div>
        <LoginForm />
        <p className="text-center text-xs text-muted-foreground">
          DNI de prueba: 12345678 (vendedor) · 87654321 (admin)
        </p>
      </div>
    </main>
  );
}
