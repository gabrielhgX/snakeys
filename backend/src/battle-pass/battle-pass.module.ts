import { Module } from '@nestjs/common';
import { CosmeticsModule } from '../cosmetics/cosmetics.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProgressionModule } from '../progression/progression.module';
import { BattlePassController } from './battle-pass.controller';
import { BattlePassService } from './battle-pass.service';

/**
 * Depends on `Progression` (for XP_BONUS reward crediting) and
 * `Cosmetics` (for SKIN minting). Both export their services so we can
 * invoke them directly and keep the whole claim flow in one DB
 * transaction.
 */
@Module({
  imports: [PrismaModule, ProgressionModule, CosmeticsModule],
  controllers: [BattlePassController],
  providers: [BattlePassService],
})
export class BattlePassModule {}
