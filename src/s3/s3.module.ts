import { Module } from '@nestjs/common';
import { S3Service } from './s3.service';

@Module({
  providers: [
    S3Service,
    {
      provide: 'IS3Service',
      useClass: S3Service,
    },
  ],
  exports: [S3Service, 'IS3Service'],
})
export class S3Module {}
