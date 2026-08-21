import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DistributedLock,
  DistributedLockSchema,
} from './distributed-lock.entity';
import { DistributedLockService } from './distributed-lock.service';

/**
 * Global so any service (RepoService, deploy pipeline, …) can inject the lock
 * without re-importing the module everywhere.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DistributedLock.name, schema: DistributedLockSchema },
    ]),
  ],
  providers: [DistributedLockService],
  exports: [DistributedLockService],
})
export class DistributedLockModule {}
