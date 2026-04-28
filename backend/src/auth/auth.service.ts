import {
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
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already in use');

    const hashed = await bcrypt.hash(dto.password, 10);
    const verificationToken = randomBytes(32).toString('hex');

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        emailVerificationToken: verificationToken,
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

    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerificationToken: null },
    });

    return { message: 'Email verified successfully' };
  }

  async logout(jti: string, expiresAt: Date): Promise<{ message: string }> {
    await this.prisma.revokedToken.upsert({
      where: { jti },
      create: { jti, expiresAt },
      update: {},
    });
    return { message: 'Logged out successfully' };
  }

  private signToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email, jti: randomUUID() });
  }
}
