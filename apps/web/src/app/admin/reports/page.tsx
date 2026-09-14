import { getSession } from "@/lib/auth/session";

export default async function AdminReportsPage() {
  const session = await getSession();

  return (
    <main className="flex flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">Reportes</h1>
      <p className="text-sm text-muted-foreground">
        Placeholder — la UI real llega en la Fase 6. Sesión activa: {session?.name} (
        {session?.role}).
      </p>
    </main>
  );
}
