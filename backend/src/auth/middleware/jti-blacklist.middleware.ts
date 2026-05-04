import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { RedisService } from '../../redis/redis.service';

/**
 * SPRINT 5 — JWT Blacklist Middleware.
 *
 * Runs before every NestJS guard (including JwtAuthGuard/JwtStrategy).
 * Extracts the raw JWT from the Authorization header, decodes the payload
 * (WITHOUT signature verification — that happens later in JwtStrategy),
 * and checks the `jti` field against the Redis blacklist.
 *
 * Why a Middleware instead of keeping it inside JwtStrategy?
 *   • Middleware runs before Passport, short-circuiting the full JWT
 *     verification pipeline for revoked tokens → faster rejection.
 *   • Routes that don't use JwtAuthGuard (e.g. GET /progression/ranking)
 *     are also protected if someone accidentally sends a revoked token.
 *   • Decouples revocation logic from the auth strategy, making both
 *     easier to test independently.
 *
 * Fail-open on Redis errors:
 *   If Redis is unavailable the middleware logs a warning and calls
 *   next().  JwtStrategy still runs and checks the PostgreSQL fallback
 *   (dual-write ensures revoked tokens are in both stores).
 *
 * Applies to all routes.  For requests without an Authorization Bearer
 * header the middleware exits immediately via next() — no Redis call.
 */
@Injectable()
export class JtiBlacklistMiddleware implements NestMiddleware {
  private readonly logger = new Logger(JtiBlacklistMiddleware.name);

  constructor(private readonly redis: RedisService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers['authorization'];

    // No bearer token → nothing to check; let guards handle auth requirements.
    if (!authHeader?.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.slice(7); // strip "Bearer "
    const jti   = this.extractJti(token);

    if (!jti) {
      // Malformed JWT (missing payload or jti field) — let JwtStrategy reject it.
      next();
      return;
    }

    try {
      const revoked = await this.redis.isJtiRevoked(jti);
      if (revoked) {
        res.status(401).json({
          statusCode: 401,
          message:    'Token has been revoked',
          error:      'Unauthorized',
        });
        return;
      }
    } catch (err) {
      // Redis unavailable — fail-open and let JwtStrategy + PostgreSQL guard catch it.
      this.logger.warn(
        `JTI blacklist Redis check failed (jti=${jti}): ${(err as Error).message} — proceeding`,
      );
    }

    next();
  }

  /**
   * Decodes the JWT payload without signature verification.
   * Returns the `jti` claim, or `null` if the token is malformed.
   *
   * A JWT is three base64url segments separated by dots:
   *   header.payload.signature
   * The payload is a JSON object; we only need the `jti` field.
   */
  private extractJti(token: string): string | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      // base64url → base64 → Buffer → JSON
      const payloadJson = Buffer.from(
        parts[1].replace(/-/g, '+').replace(/_/g, '/'),
        'base64',
      ).toString('utf8');

      const payload = JSON.parse(payloadJson) as Record<string, unknown>;
      return typeof payload.jti === 'string' ? payload.jti : null;
    } catch {
      return null;
    }
  }
}
