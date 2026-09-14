import { z } from "zod";

export const RoleSchema = z.enum(["SELLER", "ADMIN"]);
export type Role = z.infer<typeof RoleSchema>;

/**
 * The verified identity carried in the session. Never includes the DNI —
 * see docs/ARCHITECTURE.md Section I: the session cookie stores only { id, role }.
 */
export const SessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: RoleSchema,
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

/** Mock-auth login request for the MVP. Not a production authentication mechanism. */
export const LoginRequestSchema = z.object({
  dni: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  user: SessionUserSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
