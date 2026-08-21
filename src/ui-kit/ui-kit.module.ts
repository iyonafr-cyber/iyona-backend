import { Module } from '@nestjs/common';
import { UiKitService } from './ui-kit.service';

@Module({
  providers: [UiKitService],
  exports: [UiKitService],
})
export class UiKitModule {}
