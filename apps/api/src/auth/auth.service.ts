import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { loadAuthConfig, TOKEN_AUDIENCE, TOKEN_ISSUER } from "./auth.config";
import { AuthenticatedUser, TokenClaims } from "./auth.types";
import { hashPassword, verifyPassword } from "./password";

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: { id: string; name: string; role: AuthenticatedUser["role"] };
}

/**
 * Phase 11 authentication: DNI + password against the `user` table, returning a short-lived
 * HS256 token (sub = userId, plus companyId and role). The web app keeps the token inside its
 * own httpOnly session cookie and sends it as `Authorization: Bearer` on server-to-server
 * calls. The DNI is never logged.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Verified against when the DNI doesn't exist, so response time doesn't reveal it. */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Returns null for any wrong DNI/password combination (no hint which one). */
  async login(dni: string, password: string): Promise<LoginResult | null> {
    const config = loadAuthConfig();
    const user = await this.prisma.user.findUnique({ where: { dni } });
    const valid = await verifyPassword(password, user?.passwordHash ?? (await this.getDummyHash()));
    if (!user || !valid) {
      this.logger.warn("Failed login attempt");
      return null;
    }

    const claims: TokenClaims = { sub: user.id, companyId: user.companyId, role: user.role };
    const token = await this.jwt.signAsync(claims, {
      secret: config.secret,
      algorithm: "HS256",
      expiresIn: config.tokenTtlSeconds,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    this.logger.log(`User ${user.id} logged in (companyId=${user.companyId}, role=${user.role})`);
    return {
      token,
      expiresAt: new Date(Date.now() + config.tokenTtlSeconds * 1000).toISOString(),
      user: { id: user.id, name: user.name, role: user.role },
    };
  }

  /**
   * Verifies the token, then re-reads the user so a deleted user or a changed role/company
   * takes effect immediately instead of when the token expires. Returns null if invalid.
   */
  async authenticate(token: string): Promise<AuthenticatedUser | null> {
    const config = loadAuthConfig();
    let claims: TokenClaims;
    try {
      claims = await this.jwt.verifyAsync<TokenClaims>(token, {
        secret: config.secret,
        algorithms: ["HS256"],
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
      });
    } catch {
      return null;
    }
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, companyId: true, name: true, role: true } });
    if (!user || user.companyId !== claims.companyId) return null;
    return user;
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword("keom-dummy-password-for-timing");
    return this.dummyHash;
  }
}
