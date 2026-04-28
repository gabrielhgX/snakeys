import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const hashed = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        wallet: {
          create: {
            balanceAvailable: 0,
            balanceLocked: 0,
          },
        },
      },
      select: { id: true, email: true, createdAt: true },
    });

    const token = this.signToken(user.id, user.email);
    return { user, token };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = this.signToken(user.id, user.email);
    return {
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
      token,
    };
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
