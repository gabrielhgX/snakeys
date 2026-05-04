import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface JwtPayload {
  sub:   string;
  email: string;
  jti:   string;
  exp:   number;
}

/**
 * Passport JWT strategy.
 *
 * SPRINT 5 NOTE: The Redis JTI blacklist check was moved to
 * JtiBlacklistMiddleware, which runs BEFORE this strategy.  By the time
 * validate() is called, a Redis-blacklisted token is already rejected.
 *
 * This strategy retains the PostgreSQL fallback to cover:
 *   1. Tokens revoked before Sprint 4 (Redis-only store not yet active).
 *   2. Rare edge case where Redis was flushed but RevokedToken rows still exist.
 *
 * The DB query here is therefore a safety net, not the hot path.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest:  ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:     process.env.JWT_SECRET,
    });
  }

  async validate(payload: JwtPayload) {
    // PostgreSQL fallback — covers legacy revocations not in Redis.
    if (payload.jti) {
      const dbRevoked = await this.prisma.revokedToken.findUnique({
        where:  { jti: payload.jti },
        select: { jti: true },
      });
      if (dbRevoked) throw new UnauthorizedException();
    }

    const user = await this.prisma.user.findUnique({
      where:  { id: payload.sub },
      select: { id: true, email: true },
    });

    if (!user) throw new UnauthorizedException();

    return { id: user.id, email: user.email, jti: payload.jti, exp: payload.exp };
  }
}
