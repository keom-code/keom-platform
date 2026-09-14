import { z } from "zod";

const envSchema = z.object({
  SESSION_SECRET: z
    .string()
    .min(16, "SESSION_SECRET must be at least 16 characters — see .env.example"),
});

export const env = envSchema.parse({
  SESSION_SECRET: process.env.SESSION_SECRET,
});
