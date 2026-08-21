import { Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { PasswordService } from './password.service';

@Module({
  providers: [
    { provide: 'IEncryptionService', useClass: EncryptionService },
    PasswordService,
  ],
  exports: [
    { provide: 'IEncryptionService', useClass: EncryptionService },
    PasswordService,
  ],
})
export class EncryptionModule {}
