import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { InternalController } from './internal.controller';

@Module({
  imports: [WalletModule],
  controllers: [InternalController],
})
export class InternalModule {}
