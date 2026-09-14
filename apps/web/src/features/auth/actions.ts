"use server";

import { redirect } from "next/navigation";
import { LoginRequestSchema } from "@keom/contracts";
import { authService } from "@/lib/services/auth";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/session";

export interface LoginActionState {
  error?: string;
}

export async function loginAction(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = LoginRequestSchema.safeParse({ dni: formData.get("dni") });
  if (!parsed.success) {
    return { error: "Ingresa un DNI válido." };
  }

  const user = await authService.login(parsed.data.dni);
  if (!user) {
    return { error: "DNI no reconocido." };
  }

  await setSessionCookie(user);
  redirect(user.role === "ADMIN" ? "/admin/reports" : "/seller/alerts");
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
