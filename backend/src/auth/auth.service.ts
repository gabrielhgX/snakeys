import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
  ) {}

  async register(dto: RegisterDto) {
    // One query checking both unique fields so we can return a precise
    // conflict message (instead of relying on Prisma's P2002 after-the-fact).
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { cpf: dto.cpf }] },
      select: { email: true, cpf: true },
    });
    if (existing) {
      if (existing.email === dto.email) {
        throw new ConflictException('Email already in use');
      }
      throw new ConflictException('CPF already in use');
    }

    const hashed = await bcrypt.hash(dto.password, 10);
    const verificationToken = randomBytes(32).toString('hex');
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        cpf: dto.cpf,
        password: hashed,
        emailVerificationToken: verificationToken,
        emailVerificationTokenExpiresAt: tokenExpiresAt,
        wallet: { create: { balanceAvailable: 0, balanceLocked: 0 } },
      },
      select: { id: true, email: true, createdAt: true },
    });

    const token = this.signToken(user.id, user.email);

    // In production: send verificationToken via email, never expose it in the response.
    // In non-production: include it so the flow can be tested without an SMTP server.
    const res: Record<string, unknown> = { user, token };
    if (process.env.NODE_ENV !== 'production') {
      res.emailVerificationToken = verificationToken;
    }
    return res;
  }

  async login(dto: LoginDto, ip: string, userAgent: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      this.logger.warn(
        `Failed login – user not found | email=${dto.email} | ip=${ip} | ua=${userAgent}`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatch) {
      this.logger.warn(
        `Failed login – wrong password | email=${dto.email} | ip=${ip} | ua=${userAgent}`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.log(`Successful login | email=${dto.email} | ip=${ip}`);

    const token = this.signToken(user.id, user.email);
    return {
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
      token,
    };
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { emailVerificationToken: token },
    });

    if (!user) throw new NotFoundException('Invalid or expired verification token');
    if (user.emailVerified) return { message: 'Email already verified' };

    if (
      user.emailVerificationTokenExpiresAt &&
      user.emailVerificationTokenExpiresAt < new Date()
    ) {
      // Clean up the expired token so the user can request a new one
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerificationToken: null, emailVerificationTokenExpiresAt: null },
      });
      throw new BadRequestException('Verification token has expired. Please register again to get a new token.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationTokenExpiresAt: null,
      },
    });

    return { message: 'Email verified successfully' };
  }

  async logout(jti: string, expiresAt: Date): Promise<{ message: string }> {
    // SPRINT 4 — dual-write: Redis (primary, O(1) lookup) + PostgreSQL (audit trail).
    // Redis entry auto-expires when the JWT would have expired anyway, so no
    // cleanup job is needed for the blacklist.  The Prisma RevokedToken row is
    // kept for compliance / audit and cleaned up by TokenCleanupService hourly.
    await Promise.all([
      this.redis.revokeJti(jti, expiresAt),
      this.prisma.revokedToken.upsert({
        where:  { jti },
        create: { jti, expiresAt },
        update: {},
      }),
    ]);
    return { message: 'Logged out successfully' };
  }

  private signToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email, jti: randomUUID() });
  }
}
