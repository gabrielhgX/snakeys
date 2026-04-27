import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { InternalModule } from './internal/internal.module';
import { PrismaModule } from './prisma/prisma.module';
import { UserModule } from './user/user.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [PrismaModule, AuthModule, UserModule, WalletModule, InternalModule],
})
export class AppModule {}
