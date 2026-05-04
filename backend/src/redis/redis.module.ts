import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

// @Global() makes RedisService injectable anywhere without explicitly
// importing RedisModule — mirrors the pattern used by PrismaModule.
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
