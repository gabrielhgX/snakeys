import { Global, Module } from '@nestjs/common';
import { CollusionService } from './collusion.service';

/**
 * SPRINT 6 — Anti-fraud / compliance services.
 *
 * Marked `@Global` so WalletService (and any future consumer — e.g. the
 * upcoming AuditLogger) can inject {@link CollusionService} without each
 * module having to import this one explicitly.  PrismaService is already
 * globally available.
 */
@Global()
@Module({
  providers: [CollusionService],
  exports:   [CollusionService],
})
export class AntiFraudModule {}
