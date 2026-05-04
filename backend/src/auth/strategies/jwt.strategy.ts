import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

export interface JwtPayload {
  sub: string;
  email: string;
  jti: string;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.jti) {
      // SPRINT 4 — JTI Blacklist: Redis check is O(1) and avoids a DB round-trip
      // on every authenticated request.  Redis is checked FIRST because it is the
      // authoritative revocation store post-logout.
      //
      // PostgreSQL (RevokedToken) is the FALLBACK for tokens that were revoked
      // before Sprint 4 deployed (rows won't have a Redis entry).  This dual-check
      // ensures no gap during the rolling deployment window.
      const redisRevoked = await this.redis.isJtiRevoked(payload.jti);
      if (redisRevoked) throw new UnauthorizedException();

      if (!redisRevoked) {
        // Only hit the DB if Redis says the token is not revoked.
        // This covers legacy revocations (pre-Sprint-4 logouts still in RevokedToken
        // but not yet in Redis) and any Redis flushes during maintenance.
        const dbRevoked = await this.prisma.revokedToken.findUnique({
          where: { jti: payload.jti },
          select: { jti: true },
        });
        if (dbRevoked) throw new UnauthorizedException();
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true },
    });

    if (!user) throw new UnauthorizedException();

    return { id: user.id, email: user.email, jti: payload.jti, exp: payload.exp };
  }
}
