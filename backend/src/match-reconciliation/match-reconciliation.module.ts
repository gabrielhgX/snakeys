import { Module } from '@nestjs/common';
import { MatchReconciliationService } from './match-reconciliation.service';

// PrismaModule is @Global(), so PrismaService is available here without
// an explicit import.  ScheduleModule is already registered in AppModule
// (ScheduleModule.forRoot()), so the @Cron decorator works out of the box.
@Module({
  providers: [MatchReconciliationService],
})
export class MatchReconciliationModule {}
