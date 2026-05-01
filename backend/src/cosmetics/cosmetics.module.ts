import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CosmeticsController } from './cosmetics.controller';
import { CosmeticsService } from './cosmetics.service';

/**
 * `CosmeticsService` is exported so the Battle Pass module can mint
 * skins inside the same DB transaction as the claim row write — keeps
 * "claim succeeds but mint fails" from leaving an orphaned claim.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CosmeticsController],
  providers: [CosmeticsService],
  exports: [CosmeticsService],
})
export class CosmeticsModule {}
