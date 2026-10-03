import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@prisma/client";
import { AuthConfigError } from "./auth.config";
import { AuthService } from "./auth.service";
import { AuthenticatedUser, AuthRequest } from "./auth.types";

const ROLES_KEY = "keom:roles";

/** Roles allowed on a /v1 controller or handler. AuthGuard requires a valid token either way. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** The authenticated caller (set by AuthGuard). Its companyId is the only tenant scope to use. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedUser => {
  const user = context.switchToHttp().getRequest<AuthRequest>().user;
  if (!user) throw new UnauthorizedException();
  return user;
});

/**
 * Guards every /v1 data endpoint: Bearer token -> AuthService.authenticate (signature,
 * expiry, issuer/audience, fresh DB user) -> role check. The web app's own cookie/proxy
 * checks are only a UX gate (docs/ARCHITECTURE.md Section I); this is the real authorization.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const header = request.headers.authorization;
    const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
    if (!token) throw new UnauthorizedException("Missing bearer token");

    let user: AuthenticatedUser | null;
    try {
      user = await this.auth.authenticate(token);
    } catch (err) {
      if (err instanceof AuthConfigError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
    if (!user) throw new UnauthorizedException("Invalid or expired token");

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (roles && !roles.includes(user.role)) throw new ForbiddenException("Not allowed for this role");

    request.user = user;
    return true;
  }
}
