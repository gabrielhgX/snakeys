import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProgressionController } from './progression.controller';
import { ProgressionService } from './progression.service';

/**
 * `ProgressionService` is exported because both the wallet settlement
 * path and the upcoming Battle Pass claim path need to credit XP. We
 * inject it directly rather than going through HTTP so the credit is
 * part of the same DB transaction as the wallet move.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ProgressionController],
  providers: [ProgressionService],
  exports: [ProgressionService],
})
export class ProgressionModule {}
