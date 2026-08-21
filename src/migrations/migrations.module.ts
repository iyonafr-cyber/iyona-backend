import { Module } from '@nestjs/common';
import { MigrationsRunner } from './migrations.runner';

@Module({
  providers: [MigrationsRunner],
  exports: [MigrationsRunner],
})
export class MigrationsModule {}
