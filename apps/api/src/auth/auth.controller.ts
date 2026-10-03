import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { z, ZodError } from "zod";
import { AuthConfigError } from "./auth.config";
import { AuthGuard, CurrentUser } from "./auth.guard";
import { AuthService } from "./auth.service";
import { AuthenticatedUser, AuthRequest } from "./auth.types";

/**
 * Not @keom/contracts' LoginRequest (DNI only, mock auth): the real API also needs a
 * password. The contract change for the UI is documented in docs/PHASE-11-API.md.
 */
const LoginRequestSchema = z.object({
  dni: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(256),
});

/** Throttles login per DNI, not per IP: behind the Next.js server every request shares one IP. */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(raw: Record<string, unknown>): Promise<string> {
    const request = raw as unknown as AuthRequest;
    const dni = request.body?.dni;
    return typeof dni === "string" && dni ? `dni:${dni.trim()}` : `ip:${request.ip ?? "unknown"}`;
  }
}

@Controller("v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  @UseGuards(LoginThrottlerGuard)
  async login(@Body() body: unknown) {
    let input;
    try {
      input = LoginRequestSchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError) throw new BadRequestException("dni and password are required");
      throw err;
    }

    try {
      const result = await this.auth.login(input.dni, input.password);
      if (!result) throw new UnauthorizedException("Invalid credentials");
      return result;
    } catch (err) {
      if (err instanceof AuthConfigError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
  }

  /** The current session user, in @keom/contracts SessionUser shape. */
  @Get("me")
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return { id: user.id, name: user.name, role: user.role };
  }
}
