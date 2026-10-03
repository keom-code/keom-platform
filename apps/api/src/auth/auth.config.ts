/**
 * Env-driven auth config, read per call (like the rest of the API) so the API still boots
 * without it; only /v1 calls fail (503) until AUTH_JWT_SECRET is set.
 */
const MIN_SECRET_LENGTH = 32;
const DEFAULT_TOKEN_TTL_MINUTES = 12 * 60;

export const TOKEN_ISSUER = "keom-api";
export const TOKEN_AUDIENCE = "keom-web";

export class AuthConfigError extends Error {}

export interface AuthConfig {
  secret: string;
  tokenTtlSeconds: number;
}

export function loadAuthConfig(): AuthConfig {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new AuthConfigError(`Authentication is not configured: AUTH_JWT_SECRET must be set (at least ${MIN_SECRET_LENGTH} characters).`);
  }
  const raw = process.env.AUTH_TOKEN_TTL_MINUTES;
  const minutes = raw ? Number(raw) : DEFAULT_TOKEN_TTL_MINUTES;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new AuthConfigError(`AUTH_TOKEN_TTL_MINUTES must be a positive number, got "${raw}".`);
  }
  return { secret, tokenTtlSeconds: Math.round(minutes * 60) };
}

/** Login attempts allowed per DNI per minute (LoginThrottlerGuard); further attempts get 429. */
export function loginAttemptsPerMinute(): number {
  const value = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS_PER_MINUTE || 5);
  return Number.isInteger(value) && value > 0 ? value : 5;
}
